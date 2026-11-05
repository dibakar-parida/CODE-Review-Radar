import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SwarmReviewWatcher } from './watcher.js';
import { UnifiedReviewOrchestrator, MockLLMProvider } from '@cr/core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('SwarmReviewWatcher (Continuous IDE Agent Swarms)', () => {
  let tempDir: string;
  let watcher: SwarmReviewWatcher;
  const broadcastSpy = vi.fn();

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-watcher-test-'));

    // Init git repo
    await execFileAsync('git', ['init'], { cwd: tempDir });
    await execFileAsync('git', ['config', 'user.name', 'Tester'], { cwd: tempDir });
    await execFileAsync('git', ['config', 'user.email', 'tester@local.test'], { cwd: tempDir });

    const file = path.join(tempDir, 'service.ts');
    await fs.writeFile(file, 'export function run() { return 1; }\n', 'utf-8');
    await execFileAsync('git', ['add', '.'], { cwd: tempDir });
    await execFileAsync('git', ['commit', '-m', 'Init'], { cwd: tempDir });

    const orchestrator = new UnifiedReviewOrchestrator({
      cwd: tempDir,
      provider: new MockLLMProvider([]),
    });

    watcher = new SwarmReviewWatcher({
      repoRoot: tempDir,
      orchestrator,
      broadcast: broadcastSpy,
      debounceMs: 50,
    });
  });

  afterEach(async () => {
    watcher.stop();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('starts and stops background watcher correctly', () => {
    expect(watcher.isActive()).toBe(false);
    watcher.start();
    expect(watcher.isActive()).toBe(true);

    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'swarm:started',
        stage: 'watcher',
      })
    );

    watcher.stop();
    expect(watcher.isActive()).toBe(false);
  });

  it('triggers incremental review on file save and broadcasts findings', async () => {
    watcher.start();

    // Trigger review for changed file
    const findings = await watcher.triggerIncrementalReview('service.ts');
    expect(Array.isArray(findings)).toBe(true);

    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'swarm:review_started',
        stage: 'swarm',
      })
    );

    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'swarm:review_completed',
        stage: 'swarm',
      })
    );
  });
});
