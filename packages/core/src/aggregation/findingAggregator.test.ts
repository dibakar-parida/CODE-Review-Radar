import { describe, it, expect } from 'vitest';
import { FindingAggregator } from './findingAggregator.js';
import { ReviewFinding } from '@cr/shared';

describe('FindingAggregator (Deduplication & Severity Scoring Engine)', () => {
  const aggregator = new FindingAggregator({ lineTolerance: 2 });

  it('merges overlapping AI finding and static tool finding, escalating severity and boosting confidence', () => {
    const aiFinding: ReviewFinding = {
      id: 'FIND-001',
      category: 'bug',
      severity: 'minor',
      confidence: 0.75,
      filePath: 'src/calc.ts',
      startLine: 10,
      endLine: 12,
      title: 'Potential null dereference',
      explanation: 'Object may be undefined',
      evidence: 'x.compute()',
      verifiedBy: ['llm'],
    };

    const tscFinding: ReviewFinding = {
      id: 'FIND-002',
      category: 'bug',
      severity: 'critical',
      confidence: 1.0,
      filePath: 'src/calc.ts',
      startLine: 11,
      endLine: 11,
      title: 'TypeScript Compiler Diagnostic: TS2532',
      explanation: "Object is possibly 'undefined'.",
      evidence: 'src/calc.ts(11,3): error TS2532',
      verifiedBy: ['tsc'],
    };

    const aggregated = aggregator.aggregate([aiFinding, tscFinding]);

    expect(aggregated).toHaveLength(1);
    const merged = aggregated[0]!;

    expect(merged.id).toBe('BUG-001');
    expect(merged.severity).toBe('critical'); // Escalated from minor to critical
    expect(merged.confidence).toBeGreaterThanOrEqual(0.98); // Boosted by static verification
    expect(merged.verifiedBy).toContain('llm');
    expect(merged.verifiedBy).toContain('tsc');
    expect(merged.startLine).toBe(10);
    expect(merged.endLine).toBe(12);
  });

  it('boosts confidence when multiple specialized agents agree on the same code defect', () => {
    const agent1: ReviewFinding = {
      id: 'FIND-A',
      category: 'security',
      severity: 'major',
      confidence: 0.8,
      filePath: 'src/api.ts',
      startLine: 25,
      endLine: 28,
      title: 'SQL string concatenation detected',
      explanation: 'User input concatenated into query string',
      evidence: 'db.query("SELECT * FROM users WHERE id = " + id)',
      verifiedBy: ['llm'],
    };

    const agent2: ReviewFinding = {
      id: 'FIND-B',
      category: 'security',
      severity: 'critical',
      confidence: 0.85,
      filePath: 'src/api.ts',
      startLine: 26,
      endLine: 27,
      title: 'SQL Injection Vulnerability in User Lookup',
      explanation: 'Direct concatenation permits arbitrary SQL injection',
      evidence: 'id concatenated',
      suggestedPatch: '--- a/src/api.ts\n+++ b/src/api.ts\n- query("SELECT " + id)\n+ query("SELECT $1", [id])\n',
      verifiedBy: ['llm'],
    };

    const aggregated = aggregator.aggregate([agent1, agent2]);

    expect(aggregated).toHaveLength(1);
    const merged = aggregated[0]!;

    expect(merged.id).toBe('SEC-001');
    expect(merged.severity).toBe('critical');
    expect(merged.confidence).toBeGreaterThan(0.85); // Boosted for consensus
    expect(merged.suggestedPatch).toBeDefined();
  });

  it('preserves distinct non-overlapping findings across files', () => {
    const f1: ReviewFinding = {
      id: 'F1',
      category: 'quality',
      severity: 'minor',
      confidence: 0.8,
      filePath: 'src/fileA.ts',
      startLine: 5,
      endLine: 8,
      title: 'Unused variable',
      explanation: 'variable x is unused',
      evidence: 'let x = 1;',
      verifiedBy: ['eslint'],
    };

    const f2: ReviewFinding = {
      id: 'F2',
      category: 'security',
      severity: 'critical',
      confidence: 0.95,
      filePath: 'src/fileB.ts',
      startLine: 50,
      endLine: 55,
      title: 'Command Injection',
      explanation: 'child_process.exec without escaping',
      evidence: 'exec(cmd)',
      verifiedBy: ['semgrep'],
    };

    const aggregated = aggregator.aggregate([f1, f2]);
    expect(aggregated).toHaveLength(2);
    // Critical finding comes first due to severity sorting
    expect(aggregated[0]!.severity).toBe('critical');
    expect(aggregated[0]!.id).toBe('SEC-001');
    expect(aggregated[1]!.severity).toBe('minor');
    expect(aggregated[1]!.id).toBe('QUAL-001');
  });
});
