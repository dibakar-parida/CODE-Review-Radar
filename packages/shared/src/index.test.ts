import { describe, it, expect } from 'vitest';
import {
  ReviewFindingSchema,
  ReviewConfigSchema,
  generateFindingId,
  compareSeverity,
  ReviewSeverity,
} from './index.js';

describe('@cr/shared domain schemas & helpers', () => {
  it('validates a correct ReviewFinding object', () => {
    const validFinding = {
      id: 'SEC-001',
      category: 'security',
      severity: 'critical',
      confidence: 0.95,
      filePath: 'src/auth/jwt.ts',
      startLine: 12,
      endLine: 18,
      symbolName: 'verifyToken',
      title: 'Insecure JWT verification',
      explanation: 'Algorithm none allowed in header verify',
      evidence: 'jwt.verify(token, secret, { algorithms: ["none"] })',
      blastRadius: ['authRouter', 'middleware'],
      suggestedPatch: '--- a/src/auth/jwt.ts\n+++ b/src/auth/jwt.ts\n@@ -12,1 +12,1 @@\n- algorithms: ["none"]\n+ algorithms: ["HS256"]\n',
      suggestedTest: 'it("rejects none algo", () => { ... })',
      verifiedBy: ['ast', 'semgrep'],
    };

    const parsed = ReviewFindingSchema.parse(validFinding);
    expect(parsed.id).toBe('SEC-001');
    expect(parsed.severity).toBe('critical');
    expect(parsed.confidence).toBe(0.95);
  });

  it('rejects invalid confidence outside 0-1', () => {
    const invalidFinding = {
      id: 'SEC-001',
      category: 'security',
      severity: 'critical',
      confidence: 1.5,
      filePath: 'src/main.ts',
      startLine: 1,
      endLine: 2,
      title: 'Title',
      explanation: 'Explanation',
      evidence: 'code',
      verifiedBy: ['llm'],
    };

    expect(() => ReviewFindingSchema.parse(invalidFinding)).toThrow();
  });

  it('generates predictable category-prefixed IDs', () => {
    expect(generateFindingId('security', 1)).toBe('SEC-001');
    expect(generateFindingId('bug', 42)).toBe('BUG-042');
    expect(generateFindingId('performance', 105)).toBe('PERF-105');
  });

  it('correctly compares severity ranks', () => {
    expect(compareSeverity('critical', 'major')).toBeLessThan(0);
    expect(compareSeverity('minor', 'critical')).toBeGreaterThan(0);
    expect(compareSeverity('major', 'major')).toBe(0);
  });

  it('loads valid default review config', () => {
    const config = ReviewConfigSchema.parse({});
    expect(config.version).toBe(1);
    expect(config.mode).toBe('local');
    expect(config.local.endpoint).toBe('http://127.0.0.1:11434');
    expect(config.local.model).toBe('qwen2.5-coder:7b');
  });
});
