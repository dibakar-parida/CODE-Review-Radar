import { describe, it, expect } from 'vitest';
import {
  computePrVerdict,
  formatPrTerminal,
  formatPrMarkdown,
  formatPrHtml,
  PrDetails,
} from './pr.js';
import { ReviewResult } from '@cr/shared';

describe('Local PR Simulation (cr pr)', () => {
  const baseResult: ReviewResult = {
    summary: {
      target: { type: 'branch', ref: 'feature/auth', baseRef: 'main' },
      executionMode: 'local',
      modelName: 'qwen2.5-coder:7b',
      totalFindings: 0,
      bySeverity: { critical: 0, major: 0, minor: 0, info: 0 },
      byCategory: { bug: 0, security: 0, performance: 0, architecture: 0, quality: 0, testing: 0 },
      filesAnalyzed: 3,
      durationMs: 420,
      timestamp: '2026-11-05T14:00:00.000Z',
    },
    findings: [],
    diffReport: {
      target: { type: 'branch', ref: 'feature/auth', baseRef: 'main' },
      files: [],
      totalInsertions: 45,
      totalDeletions: 12,
    },
  };

  it('computes APPROVED verdict when zero issues are detected', () => {
    const verdict = computePrVerdict(baseResult);
    expect(verdict).toBe('APPROVED');
  });

  it('computes CHANGES_REQUESTED verdict when critical or major issues are detected', () => {
    const criticalResult: ReviewResult = {
      ...baseResult,
      summary: {
        ...baseResult.summary,
        totalFindings: 1,
        bySeverity: { ...baseResult.summary.bySeverity, critical: 1 },
      },
      findings: [
        {
          id: 'SEC-001',
          category: 'security',
          severity: 'critical',
          confidence: 0.99,
          filePath: 'src/auth.ts',
          startLine: 10,
          endLine: 10,
          title: 'Hardcoded Secret',
          explanation: 'Secret found in branch diff',
          evidence: 'key = "123"',
          verifiedBy: ['llm'],
        },
      ],
    };

    expect(computePrVerdict(criticalResult)).toBe('CHANGES_REQUESTED');
  });

  it('computes COMMENTED verdict when only minor or info issues are present', () => {
    const minorResult: ReviewResult = {
      ...baseResult,
      summary: {
        ...baseResult.summary,
        totalFindings: 1,
        bySeverity: { ...baseResult.summary.bySeverity, minor: 1 },
      },
      findings: [
        {
          id: 'QUAL-001',
          category: 'quality',
          severity: 'minor',
          confidence: 0.8,
          filePath: 'src/utils.ts',
          startLine: 20,
          endLine: 20,
          title: 'Variable naming convention',
          explanation: 'Prefer camelCase naming',
          evidence: 'const my_var = 1;',
          verifiedBy: ['llm'],
        },
      ],
    };

    expect(computePrVerdict(minorResult)).toBe('COMMENTED');
  });

  it('formats terminal PR review output cleanly with verdict badges', () => {
    const pr: PrDetails = {
      branch: 'feature/login',
      base: 'main',
      verdict: 'APPROVED',
    };

    const output = formatPrTerminal(baseResult, pr);
    expect(output).toContain('LOCAL PR SIMULATION: feature/login ➔ main');
    expect(output).toContain('APPROVED');
    expect(output).toContain('Files Changed: 3');
    expect(output).toContain('+45 -12');
  });

  it('formats Markdown PR review output suitable for GitHub/GitLab PR comments', () => {
    const pr: PrDetails = {
      branch: 'feature/payment',
      base: 'main',
      verdict: 'CHANGES_REQUESTED',
    };

    const findingResult: ReviewResult = {
      ...baseResult,
      summary: {
        ...baseResult.summary,
        totalFindings: 1,
        bySeverity: { ...baseResult.summary.bySeverity, critical: 1 },
      },
      findings: [
        {
          id: 'SEC-001',
          category: 'security',
          severity: 'critical',
          confidence: 0.98,
          filePath: 'src/payment.ts',
          startLine: 15,
          endLine: 18,
          title: 'Unauthenticated Payment Endpoint',
          explanation: 'Payment processing endpoint is exposed without auth middleware',
          evidence: 'app.post("/charge", processPayment);',
          blastRadius: ['route:POST /charge', 'caller:BillingService'],
          suggestedPatch: '--- a/src/payment.ts\n+++ b/src/payment.ts\n@@ -15,1 +15,1 @@\n- app.post("/charge", processPayment);\n+ app.post("/charge", authGuard, processPayment);\n',
          verifiedBy: ['llm'],
        },
      ],
    };

    const md = formatPrMarkdown(findingResult, pr);
    expect(md).toContain('# 🔀 Pull Request Review: `feature/payment` ➔ `main`');
    expect(md).toContain('CHANGES REQUESTED');
    expect(md).toContain('Unauthenticated Payment Endpoint');
    expect(md).toContain('**Downstream Blast Radius:** `route:POST /charge`, `caller:BillingService`');
    expect(md).toContain('```diff');
  });

  it('formats HTML PR report with valid markup and style headers', () => {
    const pr: PrDetails = {
      branch: 'feature/dashboard',
      base: 'main',
      verdict: 'APPROVED',
    };

    const html = formatPrHtml(baseResult, pr);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>PR Review Simulation: feature/dashboard ➔ main</title>');
    expect(html).toContain('badge-approved');
  });
});
