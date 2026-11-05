import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  installGitHook,
  uninstallGitHook,
  isGitHookInstalled,
  PRE_COMMIT_HOOK_CONTENT,
} from './hook.js';

describe('Git Pre-Commit Hook', () => {
  let tempRepo: string;

  beforeEach(async () => {
    tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-hook-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempRepo, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('fails cleanly if directory is not a git repository', async () => {
    await expect(installGitHook(tempRepo)).rejects.toThrow(/Not a git repository/);
    expect(await isGitHookInstalled(tempRepo)).toBe(false);
  });

  it('installs pre-commit hook into .git/hooks/pre-commit', async () => {
    // Setup .git directory
    await fs.mkdir(path.join(tempRepo, '.git'));

    const hookPath = await installGitHook(tempRepo);
    expect(hookPath).toBe(path.join(tempRepo, '.git', 'hooks', 'pre-commit'));

    // Check hook exists
    const isInstalled = await isGitHookInstalled(tempRepo);
    expect(isInstalled).toBe(true);

    // Read hook content
    const content = await fs.readFile(hookPath, 'utf-8');
    expect(content).toContain('Running pre-commit review');
    expect(content).toContain('--fail-on-critical');
    expect(content).toContain('cr review --target staged');
  });

  it('uninstalls pre-commit hook and handles missing hooks gracefully', async () => {
    await fs.mkdir(path.join(tempRepo, '.git'));

    // Install
    await installGitHook(tempRepo);
    expect(await isGitHookInstalled(tempRepo)).toBe(true);

    // Uninstall
    const removed = await uninstallGitHook(tempRepo);
    expect(removed).toBe(true);
    expect(await isGitHookInstalled(tempRepo)).toBe(false);

    // Second uninstall returns false (already removed)
    const removedAgain = await uninstallGitHook(tempRepo);
    expect(removedAgain).toBe(false);
  });
});
