import { describe, it, expect, vi } from 'vitest';
import {
  mapSeverityToVsCode,
  CRCodeLensProvider,
  CRQuickFixProvider,
} from './extension.js';
import { ReviewFinding } from '@cr/shared';

// Mock vscode module for node test runner
vi.mock('vscode', () => {
  return {
    DiagnosticSeverity: {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3,
    },
    Range: class Range {
      constructor(
        public startLine: number,
        public startChar: number,
        public endLine: number,
        public endChar: number
      ) {}
    },
    Diagnostic: class Diagnostic {
      constructor(
        public range: any,
        public message: string,
        public severity: number
      ) {}
    },
    CodeLens: class CodeLens {
      constructor(public range: any, public command: any) {}
    },
    CodeAction: class CodeAction {
      constructor(public title: string, public kind: any) {}
    },
    CodeActionKind: {
      QuickFix: 'quickfix',
    },
  };
});

describe('@cr/vscode-ext unit tests', () => {
  it('maps review severity levels accurately to VS Code DiagnosticSeverity', () => {
    expect(mapSeverityToVsCode('critical')).toBe(0); // Error
    expect(mapSeverityToVsCode('major')).toBe(1); // Warning
    expect(mapSeverityToVsCode('minor')).toBe(2); // Information
    expect(mapSeverityToVsCode('info')).toBe(3); // Hint
  });

  it('CRCodeLensProvider provides CodeLens actions for matching file paths', () => {
    const finding: ReviewFinding = {
      id: 'SEC-001',
      category: 'security',
      severity: 'critical',
      confidence: 0.95,
      filePath: 'src/auth.ts',
      startLine: 10,
      endLine: 15,
      title: 'Insecure cookie',
      explanation: 'Missing secure flag',
      evidence: 'res.cookie()',
      suggestedPatch: '--- a/src/auth.ts\n+++ b/src/auth.ts\n',
      verifiedBy: ['llm'],
    };

    const provider = new CRCodeLensProvider();
    provider.setFindings([finding]);

    const mockDoc = {
      uri: { fsPath: 'd:/Project/src/auth.ts' },
      lineCount: 50,
      lineAt: () => ({ text: 'const a = 1;' }),
    } as any;

    const lenses = provider.provideCodeLenses(mockDoc, {} as any);
    expect(lenses.length).toBeGreaterThanOrEqual(2);
    expect(lenses[0]?.command?.title).toContain('Apply Fix (SEC-001)');
    expect(lenses[1]?.command?.title).toContain('Explain Issue');
  });

  it('CRQuickFixProvider provides QuickFix action when range intersects finding', () => {
    const finding: ReviewFinding = {
      id: 'BUG-002',
      category: 'bug',
      severity: 'major',
      confidence: 0.9,
      filePath: 'src/calc.ts',
      startLine: 5,
      endLine: 8,
      title: 'Null check missing',
      explanation: 'Value can be null',
      evidence: 'return a.val;',
      suggestedPatch: '--- a/src/calc.ts\n+++ b/src/calc.ts\n',
      verifiedBy: ['llm'],
    };

    const provider = new CRQuickFixProvider();
    provider.setFindings([finding]);

    const mockDoc = {
      uri: { fsPath: 'd:/Project/src/calc.ts' },
    } as any;

    const mockRange = { start: { line: 6 }, end: { line: 6 } } as any;

    const actions = provider.provideCodeActions(mockDoc, mockRange, {} as any, {} as any);
    expect(actions).toHaveLength(2);
    expect(actions[0]!.title).toContain('Apply cr verified fix for BUG-002');
    expect(actions[1]!.title).toContain('Dismiss as false positive: BUG-002');
  });
});
