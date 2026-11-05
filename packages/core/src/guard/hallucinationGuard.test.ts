import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { HallucinationGuard } from './hallucinationGuard.js';
import { ReviewFinding, FileDiff } from '@cr/shared';

describe('HallucinationGuard', () => {
  let tempDir: string;
  let guard: HallucinationGuard;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-guard-test-'));
    guard = new HallucinationGuard({ repoRoot: tempDir, allowSurroundingLines: 2 });

    // Create a 20-line test file
    const content = Array.from({ length: 20 }, (_, i) => `// Line ${i + 1}`).join('\n');
    await fs.writeFile(path.join(tempDir, 'valid.ts'), content, 'utf-8');
  });

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('accepts finding that overlaps with modified hunk', async () => {
    const diff: FileDiff = {
      oldPath: 'valid.ts',
      newPath: 'valid.ts',
      status: 'modified',
      hunks: [
        {
          oldStart: 5,
          oldLines: 3,
          newStart: 5,
          newLines: 4,
          header: '@@ -5,3 +5,4 @@',
          lines: [' context', '+new line', ' context'],
        },
      ],
      raw: '',
    };

    const finding: ReviewFinding = {
      id: 'SEC-001',
      category: 'security',
      severity: 'critical',
      confidence: 0.9,
      filePath: 'valid.ts',
      startLine: 6,
      endLine: 7,
      title: 'Valid Issue',
      explanation: 'Overlaps hunk line 5-9',
      evidence: 'snippet',
      verifiedBy: ['llm'],
    };

    const result = await guard.verifyFindings([finding], diff);
    expect(result.verified).toHaveLength(1);
    expect(result.discarded).toHaveLength(0);
    expect(result.verified[0]!.verifiedBy).toContain('ast');
  });

  it('drops finding pointing to a non-existent file on disk', async () => {
    const diff: FileDiff = {
      oldPath: 'does-not-exist.ts',
      newPath: 'does-not-exist.ts',
      status: 'modified',
      hunks: [],
      raw: '',
    };

    const finding: ReviewFinding = {
      id: 'BUG-001',
      category: 'bug',
      severity: 'major',
      confidence: 0.9,
      filePath: 'does-not-exist.ts',
      startLine: 1,
      endLine: 2,
      title: 'Ghost File',
      explanation: 'File is not on disk',
      evidence: 'snippet',
      verifiedBy: ['llm'],
    };

    const result = await guard.verifyFindings([finding], diff);
    expect(result.verified).toHaveLength(0);
    expect(result.discarded).toHaveLength(1);
    expect(result.discarded[0]!.reason).toContain('does not exist on disk');
  });

  it('drops finding where line numbers are inverted or exceed file bounds', async () => {
    const diff: FileDiff = {
      oldPath: 'valid.ts',
      newPath: 'valid.ts',
      status: 'modified',
      hunks: [
        {
          oldStart: 1,
          oldLines: 2,
          newStart: 1,
          newLines: 2,
          header: '@@ -1,2 +1,2 @@',
          lines: [],
        },
      ],
      raw: '',
    };

    const invertedFinding: ReviewFinding = {
      id: 'BUG-002',
      category: 'bug',
      severity: 'minor',
      confidence: 0.8,
      filePath: 'valid.ts',
      startLine: 15,
      endLine: 10,
      title: 'Inverted Lines',
      explanation: 'start > end',
      evidence: 'snippet',
      verifiedBy: ['llm'],
    };

    const outOfBoundsFinding: ReviewFinding = {
      id: 'BUG-003',
      category: 'bug',
      severity: 'minor',
      confidence: 0.8,
      filePath: 'valid.ts',
      startLine: 50,
      endLine: 60,
      title: 'Beyond EOF',
      explanation: 'Exceeds 20 lines',
      evidence: 'snippet',
      verifiedBy: ['llm'],
    };

    const result = await guard.verifyFindings([invertedFinding, outOfBoundsFinding], diff);
    expect(result.verified).toHaveLength(0);
    expect(result.discarded).toHaveLength(2);
  });
});
