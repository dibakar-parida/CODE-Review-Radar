import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ReviewFinding, FileDiff } from '@cr/shared';

export interface GuardResult {
  verified: ReviewFinding[];
  discarded: Array<{ finding: ReviewFinding; reason: string }>;
}

export interface HallucinationGuardOptions {
  repoRoot?: string;
  allowSurroundingLines?: number; // tolerance margin around hunks
}

export class HallucinationGuard {
  private readonly repoRoot: string;
  private readonly tolerance: number;

  constructor(options: HallucinationGuardOptions = {}) {
    this.repoRoot = options.repoRoot ?? process.cwd();
    this.tolerance = options.allowSurroundingLines ?? 3;
  }

  /**
   * Verifies findings against physical files and diff hunk line bounds.
   * Drops hallucinations where file does not exist, line range is out of bounds,
   * or reported lines do not touch the changed hunks.
   */
  async verifyFindings(findings: ReviewFinding[], fileDiff: FileDiff): Promise<GuardResult> {
    const verified: ReviewFinding[] = [];
    const discarded: Array<{ finding: ReviewFinding; reason: string }> = [];

    const relativePath = fileDiff.newPath || fileDiff.oldPath;
    if (!relativePath) {
      for (const finding of findings) {
        discarded.push({ finding, reason: 'File path could not be resolved from diff' });
      }
      return { verified, discarded };
    }

    const fullPath = path.resolve(this.repoRoot, relativePath);

    // 1. Verify file exists on disk (if not deleted in diff)
    let totalLines = 0;
    if (fileDiff.status !== 'deleted') {
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        // Handle CRLF and LF
        const lines = content.replace(/\r\n/g, '\n').split('\n');
        totalLines = lines.length;
      } catch {
        // If file not readable on disk, check if it's completely new or check hunks
        if (fileDiff.status === 'added') {
          totalLines = fileDiff.hunks.reduce((acc, h) => acc + h.newLines, 0);
        } else {
          for (const finding of findings) {
            discarded.push({
              finding,
              reason: `File "${relativePath}" does not exist on disk and is not an added file`,
            });
          }
          return { verified, discarded };
        }
      }
    } else {
      totalLines = fileDiff.hunks.reduce((acc, h) => acc + h.oldLines, 0);
    }

    // 2. Build list of valid modified line ranges from hunks
    const modifiedRanges: Array<{ start: number; end: number }> = [];
    for (const hunk of fileDiff.hunks) {
      const start = Math.max(1, hunk.newStart - this.tolerance);
      const end = hunk.newStart + hunk.newLines + this.tolerance;
      modifiedRanges.push({ start, end });
    }

    for (const finding of findings) {
      // 2a. Line order validation
      if (finding.startLine > finding.endLine) {
        discarded.push({
          finding,
          reason: `startLine (${finding.startLine}) is greater than endLine (${finding.endLine})`,
        });
        continue;
      }

      // 2b. Bounds validation
      if (totalLines > 0 && finding.endLine > totalLines + 5) {
        discarded.push({
          finding,
          reason: `endLine (${finding.endLine}) exceeds file bounds (${totalLines} lines)`,
        });
        continue;
      }

      // 2c. Hunk overlap check
      const overlapsWithHunk = modifiedRanges.some(
        (range) => finding.startLine <= range.end && finding.endLine >= range.start
      );

      if (!overlapsWithHunk && modifiedRanges.length > 0) {
        discarded.push({
          finding,
          reason: `Finding lines ${finding.startLine}-${finding.endLine} do not overlap with any modified diff hunk`,
        });
        continue;
      }

      // Verification passed
      verified.push({
        ...finding,
        filePath: relativePath,
        verifiedBy: Array.from(new Set([...finding.verifiedBy, 'ast'])),
      });
    }

    return { verified, discarded };
  }
}
