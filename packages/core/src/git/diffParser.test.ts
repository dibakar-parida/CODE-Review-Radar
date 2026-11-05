import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff, calculateDiffStats, normalizeToPosix } from './diffParser.js';

describe('Unified Diff Parser', () => {
  it('normalizes windows backslashes to posix forward slashes', () => {
    expect(normalizeToPosix('packages\\core\\src\\index.ts')).toBe('packages/core/src/index.ts');
  });

  it('parses standard git unified diff with exact hunk coordinates', () => {
    const rawDiff = `diff --git a/src/math.ts b/src/math.ts
index e69de29..d95f3ad 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -10,4 +10,6 @@ export function add(a: number, b: number): number {
   const c = a + b;
-  return c;
+  // Added bounds check
+  if (c > Number.MAX_SAFE_INTEGER) throw new Error('overflow');
+  return c;
 }
`;

    const fileDiffs = parseUnifiedDiff(rawDiff);
    expect(fileDiffs).toHaveLength(1);

    const diff = fileDiffs[0]!;
    expect(diff.oldPath).toBe('src/math.ts');
    expect(diff.newPath).toBe('src/math.ts');
    expect(diff.status).toBe('modified');
    expect(diff.hunks).toHaveLength(1);

    const hunk = diff.hunks[0]!;
    expect(hunk.oldStart).toBe(10);
    expect(hunk.oldLines).toBe(4);
    expect(hunk.newStart).toBe(10);
    expect(hunk.newLines).toBe(6);

    const stats = calculateDiffStats(fileDiffs);
    expect(stats.deletions).toBe(1);
    expect(stats.insertions).toBe(3);
  });

  it('handles CRLF line endings cleanly', () => {
    const crlfDiff =
      'diff --git a/test.txt b/test.txt\r\n' +
      '--- a/test.txt\r\n' +
      '+++ b/test.txt\r\n' +
      '@@ -1,2 +1,3 @@\r\n' +
      ' line1\r\n' +
      '-line2\r\n' +
      '+line2_modified\r\n' +
      '+line3_new\r\n';

    const fileDiffs = parseUnifiedDiff(crlfDiff);
    expect(fileDiffs).toHaveLength(1);
    expect(fileDiffs[0]!.hunks[0]!.newLines).toBe(3);
    expect(fileDiffs[0]!.hunks[0]!.lines).toHaveLength(4);
  });

  it('handles new file creation and deletion diffs', () => {
    const rawDiff = `diff --git a/new-file.ts b/new-file.ts
new file mode 100644
--- /dev/null
+++ b/new-file.ts
@@ -0,0 +1,2 @@
+export const name = 'test';
+export const version = '1.0';
diff --git a/old-file.ts b/old-file.ts
deleted file mode 100644
--- a/old-file.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const dead = true;
-export const remove = true;
`;

    const fileDiffs = parseUnifiedDiff(rawDiff);
    expect(fileDiffs).toHaveLength(2);

    expect(fileDiffs[0]!.status).toBe('added');
    expect(fileDiffs[0]!.oldPath).toBeNull();
    expect(fileDiffs[0]!.newPath).toBe('new-file.ts');

    expect(fileDiffs[1]!.status).toBe('deleted');
    expect(fileDiffs[1]!.newPath).toBeNull();
    expect(fileDiffs[1]!.oldPath).toBe('old-file.ts');
  });
});
