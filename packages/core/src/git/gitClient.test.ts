import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitClient } from './gitClient.js';

const execFileAsync = promisify(execFile);

describe('GitClient with real temporary Git fixture repository', () => {
  let tempDir: string;
  let client: GitClient;

  beforeAll(async () => {
    // Create temporary directory for fixture repo
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-git-fixture-'));
    client = new GitClient({ cwd: tempDir });

    // Initialize real git repo
    await execFileAsync('git', ['init'], { cwd: tempDir });
    await execFileAsync('git', ['config', 'user.name', 'CR Tester'], { cwd: tempDir });
    await execFileAsync('git', ['config', 'user.email', 'tester@local.test'], { cwd: tempDir });

    // Initial commit
    const initialFile = path.join(tempDir, 'sample.ts');
    await fs.writeFile(
      initialFile,
      '// Line 1\nfunction compute(x: number) {\n  return x * 2;\n}\n// Line 5\n',
      'utf-8'
    );
    await execFileAsync('git', ['add', '.'], { cwd: tempDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: tempDir });
  });

  afterAll(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on windows locks
    }
  });

  it('correctly detects unstaged working tree diff and line hunks', () => {
    return (async () => {
      const sampleFile = path.join(tempDir, 'sample.ts');
      // Modify line 3
      await fs.writeFile(
        sampleFile,
        '// Line 1\nfunction compute(x: number) {\n  // Injected validation\n  if (x < 0) return 0;\n  return x * 2;\n}\n// Line 5\n',
        'utf-8'
      );

      const report = await client.getDiff({ type: 'unstaged' });
      expect(report.files.length).toBe(1);

      const fileDiff = report.files[0]!;
      expect(fileDiff.newPath).toBe('sample.ts');
      expect(fileDiff.hunks.length).toBeGreaterThan(0);

      const hunk = fileDiff.hunks[0]!;
      expect(hunk.newStart).toBe(1);
      expect(report.totalInsertions).toBeGreaterThanOrEqual(2);
    })();
  });

  it('correctly detects staged changes diff when files are git-added', () => {
    return (async () => {
      await execFileAsync('git', ['add', 'sample.ts'], { cwd: tempDir });

      const report = await client.getDiff({ type: 'staged' });
      expect(report.files.length).toBe(1);
      expect(report.files[0]!.newPath).toBe('sample.ts');

      // Unstaged diff should now be clean
      const unstagedReport = await client.getDiff({ type: 'unstaged' });
      expect(unstagedReport.files.length).toBe(0);
    })();
  });
});
