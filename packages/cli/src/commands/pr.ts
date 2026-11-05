import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import {
  ReviewResult,
  ReporterFormat,
  ReviewFinding,
} from '@cr/shared';
import {
  UnifiedReviewOrchestrator,
  GitClient,
} from '@cr/core';

export interface PrCommandOptions {
  base?: string;
  format?: string;
  output?: string;
  config?: string;
  failOnCritical?: boolean;
}

export interface PrDetails {
  branch: string;
  base: string;
  verdict: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
}

export function computePrVerdict(result: ReviewResult): 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' {
  const critical = result.summary.bySeverity.critical ?? 0;
  const major = result.summary.bySeverity.major ?? 0;
  if (critical > 0 || major > 0) {
    return 'CHANGES_REQUESTED';
  }
  if (result.summary.totalFindings > 0) {
    return 'COMMENTED';
  }
  return 'APPROVED';
}

export function formatPrTerminal(result: ReviewResult, pr: PrDetails): string {
  const lines: string[] = [];
  const verdictBadge =
    pr.verdict === 'APPROVED'
      ? '\x1b[32m✔ APPROVED\x1b[0m'
      : pr.verdict === 'CHANGES_REQUESTED'
        ? '\x1b[31m✖ CHANGES REQUESTED\x1b[0m'
        : '\x1b[33m💬 COMMENTED\x1b[0m';

  lines.push('================================================================================');
  lines.push(`🔀 LOCAL PR SIMULATION: ${pr.branch} ➔ ${pr.base}`);
  lines.push(`VERDICT: ${verdictBadge}`);
  lines.push('================================================================================');
  lines.push(`Files Changed: ${result.summary.filesAnalyzed}  |  +${result.diffReport.totalInsertions} -${result.diffReport.totalDeletions}`);
  lines.push(`Total Findings: ${result.summary.totalFindings} (Critical: ${result.summary.bySeverity.critical}, Major: ${result.summary.bySeverity.major}, Minor: ${result.summary.bySeverity.minor}, Info: ${result.summary.bySeverity.info})`);
  lines.push('');

  if (result.findings.length === 0) {
    lines.push('  No blocking issues detected! Pull request is safe to merge.');
  } else {
    lines.push('📋 SIMULATED PR REVIEW COMMENTS:');
    lines.push('--------------------------------------------------------------------------------');
    for (const f of result.findings) {
      const sevColor =
        f.severity === 'critical'
          ? '\x1b[31m'
          : f.severity === 'major'
            ? '\x1b[35m'
            : '\x1b[33m';
      lines.push(`${sevColor}[${f.severity.toUpperCase()}]\x1b[0m ${f.filePath}:${f.startLine}-${f.endLine}`);
      lines.push(`  Title:       ${f.title}`);
      lines.push(`  Category:    ${f.category}`);
      lines.push(`  Confidence:  ${Math.round(f.confidence * 100)}%`);
      lines.push(`  Comment:     ${f.explanation}`);
      if (f.evidence) {
        lines.push(`  Evidence:    ${f.evidence}`);
      }
      if (f.blastRadius && f.blastRadius.length > 0) {
        lines.push(`  Blast Radius: ${f.blastRadius.join(', ')}`);
      }
      if (f.suggestedPatch) {
        lines.push('  Suggested Diff Fix:');
        lines.push(
          f.suggestedPatch
            .split('\n')
            .map((l) => `    ${l}`)
            .join('\n')
        );
      }
      lines.push('');
    }
  }

  lines.push('================================================================================');
  return lines.join('\n');
}

export function formatPrMarkdown(result: ReviewResult, pr: PrDetails): string {
  const verdictEmoji =
    pr.verdict === 'APPROVED'
      ? '🟢 **APPROVED**'
      : pr.verdict === 'CHANGES_REQUESTED'
        ? '🔴 **CHANGES REQUESTED**'
        : '🟡 **COMMENTED**';

  const lines: string[] = [
    `# 🔀 Pull Request Review: \`${pr.branch}\` ➔ \`${pr.base}\``,
    '',
    `### **Verdict:** ${verdictEmoji}`,
    '',
    '## 📊 Overview',
    `| Metric | Value |`,
    `| --- | --- |`,
    `| **Target Branch** | \`${pr.branch}\` |`,
    `| **Base Branch** | \`${pr.base}\` |`,
    `| **Files Changed** | ${result.summary.filesAnalyzed} |`,
    `| **Diff Stats** | +${result.diffReport.totalInsertions} / -${result.diffReport.totalDeletions} |`,
    `| **Total Findings** | ${result.summary.totalFindings} |`,
    `| **Execution Time** | ${result.summary.durationMs}ms |`,
    '',
    '### Findings Severity Distribution',
    `- 🚨 **Critical:** ${result.summary.bySeverity.critical}`,
    `- ⚠️ **Major:** ${result.summary.bySeverity.major}`,
    `- ℹ️ **Minor:** ${result.summary.bySeverity.minor}`,
    `- 💡 **Info:** ${result.summary.bySeverity.info}`,
    '',
  ];

  if (result.findings.length === 0) {
    lines.push('🎉 **No issues detected! This PR satisfies all automated quality, security, and architecture gates.**');
  } else {
    lines.push('## 💬 Inline PR Review Comments');
    for (const f of result.findings) {
      lines.push(`### \`${f.filePath}\` (L${f.startLine}-L${f.endLine}) - **[${f.severity.toUpperCase()}]** ${f.title}`);
      lines.push(`> **Category:** \`${f.category}\` | **Confidence:** ${Math.round(f.confidence * 100)}% | **Verified By:** \`${f.verifiedBy?.join(', ') || 'llm'}\``);
      lines.push('');
      lines.push(`${f.explanation}`);
      lines.push('');
      if (f.evidence) {
        lines.push('**Code Context:**');
        lines.push('```ts');
        lines.push(f.evidence);
        lines.push('```');
      }
      if (f.suggestedPatch) {
        lines.push('**Suggested Fix:**');
        lines.push('```diff');
        lines.push(f.suggestedPatch);
        lines.push('```');
      }
      if (f.blastRadius && f.blastRadius.length > 0) {
        lines.push(`**Downstream Blast Radius:** ${f.blastRadius.map((b) => `\`${b}\``).join(', ')}`);
      }
      lines.push('');
      lines.push('---');
    }
  }

  return lines.join('\n');
}

export function formatPrHtml(result: ReviewResult, pr: PrDetails): string {
  const md = formatPrMarkdown(result, pr);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PR Review Simulation: ${pr.branch} ➔ ${pr.base}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; background: #0D0D0D; color: #FFFFFF; padding: 32px; max-width: 960px; margin: 0 auto; }
    h1, h2, h3 { border-bottom: 1px solid #333; padding-bottom: 8px; }
    pre { background: #161616; padding: 12px; border-radius: 6px; overflow-x: auto; border: 1px solid #282828; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { border: 1px solid #282828; padding: 8px 12px; text-align: left; }
    th { background: #1F1F1F; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-weight: bold; }
    .badge-approved { background: #39FF14; color: #000; }
    .badge-changes { background: #FF1493; color: #FFF; }
  </style>
</head>
<body>
  <div style="margin-bottom: 24px;">
    <span class="badge ${pr.verdict === 'APPROVED' ? 'badge-approved' : 'badge-changes'}">${pr.verdict}</span>
  </div>
  <pre>${md}</pre>
</body>
</html>`;
}

export function createPrCommand(): Command {
  const pr = new Command('pr')
    .description('Simulate a local GitHub/GitLab Pull Request code review without pushing upstream')
    .argument('[branch]', 'Feature branch to review (defaults to current branch)')
    .option('-b, --base <base>', 'Base branch to compare against (defaults to main)', 'main')
    .option('-f, --format <format>', 'Report format (terminal, markdown, html, json)', 'terminal')
    .option('-o, --output <file>', 'Save PR review report directly to file')
    .option('-c, --config <path>', 'Custom path to .cr.yaml config')
    .option('--fail-on-critical', 'Exit with non-zero exit code if critical or major findings exist', false)
    .action(async (branchArg: string | undefined, options: PrCommandOptions) => {
      try {
        const git = new GitClient();
        const currentBranch = branchArg || (await git.getCurrentBranch().catch(() => 'HEAD'));
        const baseBranch = options.base || 'main';

        console.log(`⚡ Simulating Local PR Review: \x1b[36m${currentBranch}\x1b[0m ➔ \x1b[32m${baseBranch}\x1b[0m...`);

        const orchestrator = new UnifiedReviewOrchestrator({
          cwd: process.cwd(),
          configPath: options.config,
        });

        const result = await orchestrator.runReview({
          type: 'branch',
          ref: currentBranch,
          baseRef: baseBranch,
        });

        const verdict = computePrVerdict(result);
        const prDetails: PrDetails = {
          branch: currentBranch,
          base: baseBranch,
          verdict,
        };

        const format = (options.format || 'terminal') as ReporterFormat;
        let formattedOutput = '';

        switch (format) {
          case 'markdown':
            formattedOutput = formatPrMarkdown(result, prDetails);
            break;
          case 'html':
            formattedOutput = formatPrHtml(result, prDetails);
            break;
          case 'json':
            formattedOutput = JSON.stringify({ pr: prDetails, ...result }, null, 2);
            break;
          case 'terminal':
          default:
            formattedOutput = formatPrTerminal(result, prDetails);
            break;
        }

        if (options.output) {
          await fs.writeFile(options.output, formattedOutput, 'utf-8');
          console.log(`\n✔ Simulated PR Review saved to ${options.output}`);
        } else {
          console.log(formattedOutput);
        }

        if (options.failOnCritical && verdict === 'CHANGES_REQUESTED') {
          process.exit(1);
        }
      } catch (err: unknown) {
        console.error(`\n✖ Local PR simulation failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return pr;
}
