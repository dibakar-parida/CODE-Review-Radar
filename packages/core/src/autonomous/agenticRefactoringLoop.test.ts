import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgenticRefactoringLoop } from '../remediation/agenticRefactoringLoop.js';
import { ReviewFinding } from '@cr/shared';

describe('AgenticRefactoringLoop', () => {
  let tempDir: string;
  let testFile: string;

  const sampleFinding: ReviewFinding = {
    id: 'BUG-001',
    category: 'bug',
    severity: 'major',
    confidence: 0.95,
    filePath: 'calculator.ts',
    startLine: 2,
    endLine: 2,
    title: 'Divide by zero bug',
    explanation: 'Denominator unvalidated',
    evidence: 'return a / b;',
    verifiedBy: ['llm'],
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-agentic-loop-test-'));
    testFile = path.join(tempDir, 'calculator.ts');
    await fs.writeFile(
      testFile,
      'export function divide(a: number, b: number) {\n  return a / b;\n}\n',
      'utf-8'
    );
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('succeeds on first attempt when patch applies and verifies cleanly', async () => {
    const validPatch = `--- a/calculator.ts
+++ b/calculator.ts
@@ -2,1 +2,2 @@
-  return a / b;
+  if (b === 0) throw new Error("Division by zero");
+  return a / b;
`;

    const loop = new AgenticRefactoringLoop({
      repoRoot: tempDir,
      maxAttempts: 3,
      customVerify: async (_path, content) => !content.includes('syntax_error'),
    });

    const result = await loop.executeLoop('calculator.ts', validPatch, sampleFinding);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.committed).toBe(true);
    expect(result.rolledBack).toBe(false);

    const modifiedContent = await fs.readFile(testFile, 'utf-8');
    expect(modifiedContent).toContain('if (b === 0) throw new Error');
  });

  it('autonomously repairs broken patch and succeeds on second attempt', async () => {
    // Attempt 1: Malformed patch with broken syntax
    const brokenPatch = `--- a/calculator.ts
+++ b/calculator.ts
@@ -2,1 +2,1 @@
-  return a / b;
+  return a / b syntax_error_here;
`;

    // Attempt 2: Repaired patch
    const repairedPatch = `--- a/calculator.ts
+++ b/calculator.ts
@@ -2,1 +2,2 @@
-  return a / b;
+  if (b === 0) return 0;
+  return a / b;
`;

    let repairCalls = 0;
    const loop = new AgenticRefactoringLoop({
      repoRoot: tempDir,
      maxAttempts: 3,
      customVerify: async (_path, content) => {
        if (content.includes('syntax_error_here')) {
          return { success: false, error: 'SyntaxError: Unexpected identifier syntax_error_here' };
        }
        return true;
      },
      repairFn: async (context) => {
        repairCalls++;
        expect(context.attempt).toBe(1);
        expect(context.failedPatch).toContain('syntax_error_here');
        return repairedPatch;
      },
    });

    const result = await loop.executeLoop('calculator.ts', brokenPatch, sampleFinding);

    expect(repairCalls).toBe(1);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.committed).toBe(true);

    const finalContent = await fs.readFile(testFile, 'utf-8');
    expect(finalContent).toContain('if (b === 0) return 0;');
  });

  it('rolls back to original state if all attempts fail verification', async () => {
    const unfixablePatch = `--- a/calculator.ts
+++ b/calculator.ts
@@ -2,1 +2,1 @@
-  return a / b;
+  totally invalid javascript !!!
`;

    const originalContent = await fs.readFile(testFile, 'utf-8');

    const loop = new AgenticRefactoringLoop({
      repoRoot: tempDir,
      maxAttempts: 2,
      customVerify: async (_path, content) => {
        if (content.includes('totally invalid')) {
          return { success: false, error: 'SyntaxError: totally invalid' };
        }
        return true;
      },
      repairFn: async () => unfixablePatch, // Keep returning broken patch
    });

    const result = await loop.executeLoop('calculator.ts', unfixablePatch, sampleFinding);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.rolledBack).toBe(true);
    expect(result.committed).toBe(false);

    // File content must be exactly restored to original state!
    const restoredContent = await fs.readFile(testFile, 'utf-8');
    expect(restoredContent).toBe(originalContent);
  });
});
