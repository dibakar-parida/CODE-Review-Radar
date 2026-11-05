import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorage } from '../indexing/sqliteStorage.js';
import { ReviewMemory } from './reviewMemory.js';
import { ReviewFinding } from '@cr/shared';

describe('ReviewMemory', () => {
  let storage: SQLiteStorage;
  let memory: ReviewMemory;

  beforeEach(() => {
    storage = new SQLiteStorage({ dbPath: ':memory:' });
    memory = new ReviewMemory(storage);
  });

  afterEach(() => {
    storage.close();
  });

  const sampleFinding1: ReviewFinding = {
    id: 'cr-bug-1',
    category: 'bug',
    severity: 'major',
    confidence: 0.9,
    filePath: 'src/billing.ts',
    startLine: 12,
    endLine: 14,
    title: 'Potential null pointer in invoice generation',
    explanation: 'Accessing invoice.items without null check',
    evidence: 'const total = invoice.items.length;',
    verifiedBy: ['llm'],
  };

  const sampleFinding2: ReviewFinding = {
    id: 'cr-sec-1',
    category: 'security',
    severity: 'critical',
    confidence: 0.95,
    filePath: 'src/auth.ts',
    startLine: 40,
    endLine: 42,
    title: 'Hardcoded secret in token validation',
    explanation: 'JWT secret appears hardcoded in source',
    evidence: 'jwt.verify(token, "supersecret");',
    verifiedBy: ['llm'],
  };

  it('generates deterministic pattern hashes for identical defects', () => {
    const hash1 = memory.computePatternHash(sampleFinding1);
    const hash2 = memory.computePatternHash(sampleFinding1);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{16}$/);

    // Finding with different title or evidence should produce different hash
    const differentFinding = {
      ...sampleFinding1,
      title: 'Completely different logic flaw',
    };
    const hashDifferent = memory.computePatternHash(differentFinding);
    expect(hashDifferent).not.toBe(hash1);
  });

  it('records decisions and filters ignored false positives', () => {
    expect(memory.isIgnored(sampleFinding1)).toBe(false);

    // Developer marks sampleFinding1 as ignored (false positive)
    memory.recordDecision(sampleFinding1, 'ignored', 'Intended behavior; invoice items are guaranteed non-null');

    expect(memory.isIgnored(sampleFinding1)).toBe(true);
    expect(memory.isIgnored(sampleFinding2)).toBe(false);

    // Filter findings
    const { active, suppressed } = memory.filterIgnoredFindings([sampleFinding1, sampleFinding2]);

    expect(active.length).toBe(1);
    expect(active[0]!.id).toBe('cr-sec-1');

    expect(suppressed.length).toBe(1);
    expect(suppressed[0]!.id).toBe('cr-bug-1');
  });

  it('aggregates accepted conventions to enrich future LLM prompts', () => {
    // Record multiple accepted decisions
    memory.recordDecision(sampleFinding1, 'accepted', 'Fixed in PR');
    memory.recordDecision(sampleFinding1, 'accepted', 'Enforced in codebase');
    memory.recordDecision(sampleFinding2, 'accepted', 'Secret moved to env');

    const conventionsPrompt = memory.getConventionsContext();

    expect(conventionsPrompt).toContain('Learned Repository Conventions');
    expect(conventionsPrompt).toContain('[BUG] Potential null pointer in invoice generation (accepted 2x)');
    expect(conventionsPrompt).toContain('[SECURITY] Hardcoded secret in token validation (accepted 1x)');
  });

  it('returns empty conventions string when no accepted findings exist', () => {
    expect(memory.getConventionsContext()).toBe('');
  });
});
