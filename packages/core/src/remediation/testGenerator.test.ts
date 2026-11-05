import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { TestGenerator } from './testGenerator.js';
import { AtomicTransactionManager } from './transactionManager.js';
import { ReviewFinding } from '@cr/shared';

describe('TestGenerator', () => {
  let tempDir: string;
  let testGen: TestGenerator;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-testgen-test-'));
    testGen = new TestGenerator(tempDir);
  });

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('resolves test file paths across languages', () => {
    expect(testGen.resolveTestFilePath('src/auth/jwt.ts')).toBe('src/auth/jwt.test.ts');
    expect(testGen.resolveTestFilePath('services/user.py')).toBe('services/test_user.py');
    expect(testGen.resolveTestFilePath('src/main/Order.java')).toBe('src/main/OrderTest.java');
  });

  it('generates a complete Vitest regression test suite for a ReviewFinding', () => {
    const finding: ReviewFinding = {
      id: 'BUG-007',
      category: 'bug',
      severity: 'major',
      confidence: 0.9,
      filePath: 'src/calc.ts',
      startLine: 10,
      endLine: 12,
      symbolName: 'multiply',
      title: 'Integer overflow in multiply()',
      explanation: 'Multiplying large integers exceeds safe bounds without guard',
      evidence: 'return a * b;',
      suggestedTest: `
  it('throws when result exceeds MAX_SAFE_INTEGER', () => {
    expect(() => multiply(Number.MAX_SAFE_INTEGER, 2)).toThrow();
  });`,
      verifiedBy: ['llm'],
    };

    const fixture = testGen.generateTestFixture(finding);

    expect(fixture.testFilePath).toBe('src/calc.test.ts');
    expect(fixture.testCode).toContain('describe(\'multiply regression suite for BUG-007\'');
    expect(fixture.testCode).toContain('throws when result exceeds MAX_SAFE_INTEGER');
  });

  it('saves generated test fixture inside an atomic transaction', async () => {
    const finding: ReviewFinding = {
      id: 'SEC-042',
      category: 'security',
      severity: 'critical',
      confidence: 0.98,
      filePath: 'src/auth.ts',
      startLine: 20,
      endLine: 22,
      symbolName: 'verifySession',
      title: 'Insecure cookie check',
      explanation: 'Missing secure flag',
      evidence: 'res.cookie(...)',
      verifiedBy: ['llm'],
    };

    const fixture = testGen.generateTestFixture(finding);
    const tx = new AtomicTransactionManager(tempDir);

    await testGen.saveTestFixture(fixture, tx);
    await tx.verifyAndCommit();

    const createdPath = path.join(tempDir, fixture.testFilePath);
    const savedContent = await fs.readFile(createdPath, 'utf-8');

    expect(savedContent).toContain('SEC-042');
    expect(savedContent).toContain('describe(');
  });
});
