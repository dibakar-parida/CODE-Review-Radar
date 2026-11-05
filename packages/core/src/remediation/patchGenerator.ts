import { normalizeToPosix } from '../git/diffParser.js';

export interface HunkEdit {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export class PatchGenerator {
  /**
   * Generates a unified diff string between original and modified file contents.
   */
  createUnifiedDiff(filePath: string, original: string, modified: string): string {
    const posixPath = normalizeToPosix(filePath);
    const origLines = original.replace(/\r\n/g, '\n').split('\n');
    const modLines = modified.replace(/\r\n/g, '\n').split('\n');

    if (original === modified) {
      return '';
    }

    // Find first differing line
    let start = 0;
    while (
      start < origLines.length &&
      start < modLines.length &&
      origLines[start] === modLines[start]
    ) {
      start++;
    }

    // Find last differing line from end
    let origEnd = origLines.length - 1;
    let modEnd = modLines.length - 1;
    while (
      origEnd >= start &&
      modEnd >= start &&
      origLines[origEnd] === modLines[modEnd]
    ) {
      origEnd--;
      modEnd--;
    }

    const contextBefore = Math.max(0, start - 3);
    const oldSliceCount = origEnd - contextBefore + 1;
    const newSliceCount = modEnd - contextBefore + 1;

    const hunkLines: string[] = [];

    // Context before
    for (let i = contextBefore; i < start; i++) {
      hunkLines.push(` ${origLines[i] ?? ''}`);
    }

    // Deletions
    for (let i = start; i <= origEnd; i++) {
      hunkLines.push(`-${origLines[i] ?? ''}`);
    }

    // Additions
    for (let i = start; i <= modEnd; i++) {
      hunkLines.push(`+${modLines[i] ?? ''}`);
    }

    // Context after
    const contextAfterEnd = Math.min(origLines.length, origEnd + 4);
    for (let i = origEnd + 1; i < contextAfterEnd; i++) {
      hunkLines.push(` ${origLines[i] ?? ''}`);
    }

    const oldStart = contextBefore + 1;
    const oldLinesCount = oldSliceCount + (contextAfterEnd - (origEnd + 1));
    const newStart = contextBefore + 1;
    const newLinesCount = newSliceCount + (contextAfterEnd - (origEnd + 1));

    const header = `@@ -${oldStart},${oldLinesCount} +${newStart},${newLinesCount} @@`;

    return [
      `--- a/${posixPath}`,
      `+++ b/${posixPath}`,
      header,
      ...hunkLines,
      '',
    ].join('\n');
  }

  /**
   * Applies a unified diff patch string to original file content.
   */
  applyPatch(originalContent: string, patchText: string): string {
    const isCrlf = originalContent.includes('\r\n');
    const normalizedOrig = originalContent.replace(/\r\n/g, '\n');
    const origLines = normalizedOrig.split('\n');

    const patchLines = patchText.replace(/\r\n/g, '\n').split('\n');

    let hunk: { oldStart: number; oldLines: number; lines: string[] } | null = null;
    const hunks: Array<{ oldStart: number; oldLines: number; lines: string[] }> = [];

    for (const line of patchLines) {
      if (line.startsWith('@@ ')) {
        const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (match) {
          hunk = {
            oldStart: parseInt(match[1]!, 10),
            oldLines: match[2] ? parseInt(match[2], 10) : 1,
            lines: [],
          };
          hunks.push(hunk);
        }
      } else if (hunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
        hunk.lines.push(line);
      }
    }

    if (hunks.length === 0) {
      return originalContent;
    }

    // Apply hunks in reverse line order so offsets remain valid
    hunks.sort((a, b) => b.oldStart - a.oldStart);

    const resultLines = [...origLines];

    for (const h of hunks) {
      const startIndex = Math.max(0, h.oldStart - 1);
      const deleteCount = h.oldLines;

      const replacementLines: string[] = [];
      for (const hl of h.lines) {
        if (hl.startsWith('+')) {
          replacementLines.push(hl.slice(1));
        } else if (hl.startsWith(' ')) {
          replacementLines.push(hl.slice(1));
        }
        // '-' lines are deleted
      }

      resultLines.splice(startIndex, deleteCount, ...replacementLines);
    }

    const result = resultLines.join(isCrlf ? '\r\n' : '\n');
    return result;
  }
}
