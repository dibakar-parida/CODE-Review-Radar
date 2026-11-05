import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { AtomicTransactionManager } from './transactionManager.js';

describe('AtomicTransactionManager (Safe File Mutation & Rollback)', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-tx-test-'));
  });

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('applies a patch and commits when verification succeeds', async () => {
    const filePath = 'src/service.ts';
    const absPath = path.join(tempDir, filePath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const originalContent = 'export function run() {\n  return 1;\n}\n';
    await fs.writeFile(absPath, originalContent, 'utf-8');

    const tx = new AtomicTransactionManager(tempDir);

    const patch = `--- a/src/service.ts
+++ b/src/service.ts
@@ -1,3 +1,3 @@
 export function run() {
-  return 1;
+  return 42;
 }
`;

    await tx.applyPatchToFile(filePath, patch);

    const verifyResult = await tx.verifyAndCommit({
      customVerify: async () => true,
    });

    expect(verifyResult.success).toBe(true);
    expect(tx.getStatus()).toBe('committed');

    const finalContent = await fs.readFile(absPath, 'utf-8');
    expect(finalContent).toContain('return 42;');
  });

  it('automatically rolls back file to original state if verification fails', async () => {
    const filePath = 'src/critical.ts';
    const absPath = path.join(tempDir, filePath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const pristineContent = '// Pristine original code\nexport const safe = true;\n';
    await fs.writeFile(absPath, pristineContent, 'utf-8');

    const tx = new AtomicTransactionManager(tempDir);

    const badPatch = `--- a/src/critical.ts
+++ b/src/critical.ts
@@ -1,2 +1,2 @@
 // Pristine original code
-export const safe = true;
+export const safe = false; // BROKEN SYNTAX
`;

    // Apply the bad patch
    await tx.applyPatchToFile(filePath, badPatch);

    // Verify it was temporarily mutated on disk
    const mutated = await fs.readFile(absPath, 'utf-8');
    expect(mutated).toContain('safe = false');

    // Verification fails
    const verifyResult = await tx.verifyAndCommit({
      customVerify: async () => {
        throw new Error('Typecheck broke due to invalid syntax');
      },
    });

    expect(verifyResult.success).toBe(false);
    expect(verifyResult.error).toContain('Typecheck broke');
    expect(tx.getStatus()).toBe('rolled_back');

    // Ensure pristine content was restored automatically
    const restored = await fs.readFile(absPath, 'utf-8');
    expect(restored).toBe(pristineContent);
  });
});
