import * as vscode from 'vscode';
import { ReviewFinding, ReviewSeverity } from '@cr/shared';
import { UnifiedReviewOrchestrator, AtomicTransactionManager } from '@cr/core';

export function mapSeverityToVsCode(severity: ReviewSeverity): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'critical':
      return vscode.DiagnosticSeverity.Error;
    case 'major':
      return vscode.DiagnosticSeverity.Warning;
    case 'minor':
      return vscode.DiagnosticSeverity.Information;
    case 'info':
    default:
      return vscode.DiagnosticSeverity.Hint;
  }
}

export function findingToDiagnostic(
  finding: ReviewFinding,
  document: vscode.TextDocument
): vscode.Diagnostic {
  const startLine = Math.max(0, finding.startLine - 1);
  const endLine = Math.min(document.lineCount - 1, Math.max(startLine, finding.endLine - 1));

  const startChar = 0;
  const endChar = document.lineAt(endLine).text.length;

  const range = new vscode.Range(startLine, startChar, endLine, endChar);
  const severity = mapSeverityToVsCode(finding.severity);

  const message = `[cr: ${finding.id}] ${finding.title}\n${finding.explanation}`;
  const diagnostic = new vscode.Diagnostic(range, message, severity);

  diagnostic.source = 'cr';
  diagnostic.code = finding.id;

  return diagnostic;
}

export class CRCodeLensProvider implements vscode.CodeLensProvider {
  private findings: ReviewFinding[] = [];

  setFindings(findings: ReviewFinding[]): void {
    this.findings = findings;
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const codeLenses: vscode.CodeLens[] = [];

    const docPath = document.uri.fsPath.replace(/\\/g, '/');
    const matching = this.findings.filter((f) => docPath.endsWith(f.filePath));

    for (const f of matching) {
      const line = Math.max(0, f.startLine - 1);
      const range = new vscode.Range(line, 0, line, 0);

      // Lens 1: Apply Fix
      if (f.suggestedPatch) {
        codeLenses.push(
          new vscode.CodeLens(range, {
            title: `⚡ cr: Apply Fix (${f.id})`,
            command: 'cr.applyFix',
            arguments: [f],
          })
        );
      }

      // Lens 2: Explain Context
      codeLenses.push(
        new vscode.CodeLens(range, {
          title: `🔍 cr: Explain Issue`,
          command: 'cr.explainFinding',
          arguments: [f],
        })
      );

      // Lens 3: Dismiss False Positive (Telemetry)
      codeLenses.push(
        new vscode.CodeLens(range, {
          title: `🚫 cr: Dismiss`,
          command: 'cr.ignoreFinding',
          arguments: [f],
        })
      );
    }

    return codeLenses;
  }
}

export class CRQuickFixProvider implements vscode.CodeActionProvider {
  private findings: ReviewFinding[] = [];

  setFindings(findings: ReviewFinding[]): void {
    this.findings = findings;
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    _context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const docPath = document.uri.fsPath.replace(/\\/g, '/');

    for (const f of this.findings) {
      if (!docPath.endsWith(f.filePath)) continue;

      const fStart = Math.max(0, f.startLine - 1);
      const fEnd = Math.max(fStart, f.endLine - 1);

      if (range.start.line <= fEnd && range.end.line >= fStart) {
        if (f.suggestedPatch) {
          const action = new vscode.CodeAction(
            `⚡ Apply cr verified fix for ${f.id}: ${f.title}`,
            vscode.CodeActionKind.QuickFix
          );
          action.command = {
            command: 'cr.applyFix',
            title: 'Apply Verified Fix',
            arguments: [f],
          };
          action.isPreferred = true;
          actions.push(action);
        }

        const dismissAction = new vscode.CodeAction(
          `🚫 Dismiss as false positive: ${f.id}`,
          vscode.CodeActionKind.QuickFix
        );
        dismissAction.command = {
          command: 'cr.ignoreFinding',
          title: 'Dismiss False Positive',
          arguments: [f],
        };
        actions.push(dismissAction);
      }
    }

    return actions;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('cr');
  context.subscriptions.push(diagnosticCollection);

  const codeLensProvider = new CRCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
  );

  const quickFixProvider = new CRQuickFixProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, quickFixProvider)
  );

  let currentFindings: ReviewFinding[] = [];

  // Command: Review Staged Changes
  const reviewStagedCmd = vscode.commands.registerCommand('cr.reviewStaged', async () => {
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'cr: Running local review on staged changes...',
        cancellable: false,
      },
      async () => {
        try {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          const root = workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
          const orchestrator = new UnifiedReviewOrchestrator({ cwd: root });

          const result = await orchestrator.runReview({ type: 'staged' });
          currentFindings = result.findings;

          codeLensProvider.setFindings(currentFindings);
          quickFixProvider.setFindings(currentFindings);

          // Update diagnostics
          diagnosticCollection.clear();
          const byDoc = new Map<string, vscode.Diagnostic[]>();

          for (const doc of vscode.workspace.textDocuments) {
            const posix = doc.uri.fsPath.replace(/\\/g, '/');
            const matching = currentFindings.filter((f) => posix.endsWith(f.filePath));
            const diags = matching.map((f) => findingToDiagnostic(f, doc));
            byDoc.set(doc.uri.toString(), diags);
            diagnosticCollection.set(doc.uri, diags);
          }

          vscode.window.showInformationMessage(
            `cr review complete: ${result.summary.totalFindings} finding(s) detected.`
          );
        } catch (err: unknown) {
          vscode.window.showErrorMessage(`cr review failed: ${(err as Error).message}`);
        }
      }
    );
  });
  context.subscriptions.push(reviewStagedCmd);

  // Command: Apply Fix
  const applyFixCmd = vscode.commands.registerCommand('cr.applyFix', async (finding: ReviewFinding) => {
    if (!finding?.suggestedPatch) return;

    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      const root = workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
      const tx = new AtomicTransactionManager(root);

      await tx.applyPatchToFile(finding.filePath, finding.suggestedPatch);
      const verifyResult = await tx.verifyAndCommit({ runTypecheck: true });

      if (verifyResult.success) {
        vscode.window.showInformationMessage(`✔ Fix committed & verified for ${finding.id}`);
        // Telemetry: record accepted decision
        const orchestrator = new UnifiedReviewOrchestrator({ cwd: root });
        orchestrator.getReviewMemory().recordDecision(finding, 'accepted', 'Applied via VS Code quick fix');
        await fetch('http://127.0.0.1:3100/api/telemetry/decision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ finding, decision: 'accepted', reason: 'Applied via VS Code quick fix' }),
        }).catch(() => {});

        // Remove diagnostic
        currentFindings = currentFindings.filter((f) => f.id !== finding.id);
        codeLensProvider.setFindings(currentFindings);
        quickFixProvider.setFindings(currentFindings);
      } else {
        vscode.window.showErrorMessage(
          `✖ Fix failed verification and was rolled back:\n${verifyResult.error}`
        );
      }
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Failed to apply fix: ${(err as Error).message}`);
    }
  });
  context.subscriptions.push(applyFixCmd);

  // Command: Ignore / Dismiss Finding (Telemetry)
  const ignoreFindingCmd = vscode.commands.registerCommand('cr.ignoreFinding', async (finding: ReviewFinding) => {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      const root = workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
      const orchestrator = new UnifiedReviewOrchestrator({ cwd: root });
      orchestrator.getReviewMemory().recordDecision(finding, 'ignored', 'Dismissed from VS Code');

      await fetch('http://127.0.0.1:3100/api/telemetry/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finding, decision: 'ignored', reason: 'Dismissed from VS Code' }),
      }).catch(() => {});

      currentFindings = currentFindings.filter((f) => f.id !== finding.id);
      codeLensProvider.setFindings(currentFindings);
      quickFixProvider.setFindings(currentFindings);

      vscode.window.showInformationMessage(`Finding ${finding.id} dismissed and recorded in review memory.`);
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Failed to dismiss finding: ${(err as Error).message}`);
    }
  });
  context.subscriptions.push(ignoreFindingCmd);

  // Command: Explain Finding
  const explainCmd = vscode.commands.registerCommand('cr.explainFinding', (finding: ReviewFinding) => {
    vscode.window.showInformationMessage(
      `[${finding.id}] ${finding.title}\n\nExplanation: ${finding.explanation}\nEvidence: ${finding.evidence}`,
      { modal: true }
    );
  });
  context.subscriptions.push(explainCmd);
}

export function deactivate(): void {}
