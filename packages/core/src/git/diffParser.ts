import { FileDiff, GitHunk, FileDiffStatus } from '@cr/shared';
import * as path from 'node:path';

/**
 * Normalizes a path string to POSIX format with forward slashes.
 */
export function normalizeToPosix(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Parses raw unified diff text into structured FileDiff objects.
 * Handles both CRLF and LF line endings.
 */
export function parseUnifiedDiff(rawDiff: string): FileDiff[] {
  if (!rawDiff || rawDiff.trim().length === 0) {
    return [];
  }

  // Normalize line endings to LF
  const normalized = rawDiff.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  const fileDiffs: FileDiff[] = [];
  let currentFile: {
    oldPath: string | null;
    newPath: string | null;
    status: FileDiffStatus;
    hunks: GitHunk[];
    rawLines: string[];
  } | null = null;

  let currentHunk: GitHunk | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Check for git diff header: diff --git a/... b/...
    if (line.startsWith('diff --git ')) {
      if (currentFile) {
        if (currentHunk) {
          currentFile.hunks.push(currentHunk);
          currentHunk = null;
        }
        fileDiffs.push({
          oldPath: currentFile.oldPath,
          newPath: currentFile.newPath,
          status: currentFile.status,
          hunks: currentFile.hunks,
          raw: currentFile.rawLines.join('\n'),
        });
      }

      const match = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
      currentFile = {
        oldPath: match ? normalizeToPosix(match[1]!) : null,
        newPath: match ? normalizeToPosix(match[2]!) : null,
        status: 'modified',
        hunks: [],
        rawLines: [line],
      };
      continue;
    }

    if (!currentFile) {
      continue;
    }

    currentFile.rawLines.push(line);

    // Detect status from git metadata
    if (line.startsWith('new file mode ')) {
      currentFile.status = 'added';
      currentFile.oldPath = null;
    } else if (line.startsWith('deleted file mode ')) {
      currentFile.status = 'deleted';
      currentFile.newPath = null;
    } else if (line.startsWith('similarity index ')) {
      currentFile.status = 'renamed';
    } else if (line.startsWith('--- ')) {
      const p = line.slice(4).trim();
      if (p === '/dev/null') {
        currentFile.oldPath = null;
      } else if (p.startsWith('a/')) {
        currentFile.oldPath = normalizeToPosix(p.slice(2));
      }
    } else if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      if (p === '/dev/null') {
        currentFile.newPath = null;
      } else if (p.startsWith('b/')) {
        currentFile.newPath = normalizeToPosix(p.slice(2));
      }
    } else if (line.startsWith('@@ ')) {
      // Hunk header: @@ -oldStart,oldLines +newStart,newLines @@
      if (currentHunk) {
        currentFile.hunks.push(currentHunk);
      }

      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (hunkMatch) {
        const oldStart = parseInt(hunkMatch[1]!, 10);
        const oldLines = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
        const newStart = parseInt(hunkMatch[3]!, 10);
        const newLines = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1;

        currentHunk = {
          oldStart,
          oldLines,
          newStart,
          newLines,
          header: line,
          lines: [],
        };
      }
    } else if (currentHunk) {
      // Hunk content line (+, -, or space context, or \ No newline at end of file)
      if (
        line.startsWith('+') ||
        line.startsWith('-') ||
        line.startsWith(' ') ||
        line.startsWith('\\')
      ) {
        currentHunk.lines.push(line);
      }
    }
  }

  if (currentFile) {
    if (currentHunk) {
      currentFile.hunks.push(currentHunk);
    }
    fileDiffs.push({
      oldPath: currentFile.oldPath,
      newPath: currentFile.newPath,
      status: currentFile.status,
      hunks: currentFile.hunks,
      raw: currentFile.rawLines.join('\n'),
    });
  }

  return fileDiffs;
}

/**
 * Calculates total additions and deletions in file diffs.
 */
export function calculateDiffStats(fileDiffs: FileDiff[]): { insertions: number; deletions: number } {
  let insertions = 0;
  let deletions = 0;

  for (const file of fileDiffs) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          insertions++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          deletions++;
        }
      }
    }
  }

  return { insertions, deletions };
}
