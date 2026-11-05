import { describe, it, expect } from 'vitest';
import { PatchGenerator } from './patchGenerator.js';

describe('PatchGenerator', () => {
  const patchGen = new PatchGenerator();

  it('generates a clean unified diff patch between original and modified strings', () => {
    const original = `function greet(name: string) {
  console.log('Hello ' + name);
  return true;
}
`;
    const modified = `function greet(name: string) {
  if (!name) throw new Error('name required');
  console.log('Hello ' + name);
  return true;
}
`;

    const diff = patchGen.createUnifiedDiff('src/greet.ts', original, modified);

    expect(diff).toContain('--- a/src/greet.ts');
    expect(diff).toContain('+++ b/src/greet.ts');
    expect(diff).toContain('+  if (!name) throw new Error(\'name required\');');
  });

  it('applies a unified diff patch to file content accurately', () => {
    const original = `line 1
line 2
line 3
line 4
`;
    const patch = `--- a/test.txt
+++ b/test.txt
@@ -2,2 +2,3 @@
-line 2
+line 2 (modified)
+line 2.5 (new)
 line 3
`;

    const result = patchGen.applyPatch(original, patch);

    expect(result).toContain('line 2 (modified)');
    expect(result).toContain('line 2.5 (new)');
    expect(result).not.toContain('line 2\n');
  });

  it('preserves CRLF line endings when applying patches', () => {
    const originalCrlf = 'line 1\r\nline 2\r\nline 3\r\n';
    const patch = `--- a/test.txt
+++ b/test.txt
@@ -2,1 +2,1 @@
-line 2
+line 2 CRLF
`;

    const result = patchGen.applyPatch(originalCrlf, patch);
    expect(result).toContain('\r\n');
    expect(result).toContain('line 2 CRLF');
  });
});
