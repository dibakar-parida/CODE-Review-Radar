import * as fs from 'node:fs';
import * as path from 'node:path';
import { UnifiedReviewOrchestrator } from '@cr/core';
import { ReviewFinding } from '@cr/shared';

export interface SwarmWatcherOptions {
  repoRoot: string;
  orchestrator: UnifiedReviewOrchestrator;
  broadcast: (event: { type: string; stage?: string; detail?: string; payload?: unknown }) => void;
  debounceMs?: number;
}

export class SwarmReviewWatcher {
  private readonly repoRoot: string;
  private readonly orchestrator: UnifiedReviewOrchestrator;
  private readonly broadcast: (event: { type: string; stage?: string; detail?: string; payload?: unknown }) => void;
  private readonly debounceMs: number;
  private watcher?: fs.FSWatcher;
  private debounceTimer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(options: SwarmWatcherOptions) {
    this.repoRoot = options.repoRoot;
    this.orchestrator = options.orchestrator;
    this.broadcast = options.broadcast;
    this.debounceMs = options.debounceMs ?? 250;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      this.watcher = fs.watch(
        this.repoRoot,
        { recursive: true },
        (_eventType: string, filename: string | null) => {
          if (!filename) return;

          // Normalize and filter
          const normalized = filename.replace(/\\/g, '/');
          if (
            normalized.includes('node_modules') ||
            normalized.includes('.git') ||
            normalized.includes('dist') ||
            normalized.includes('.cr') ||
            normalized.includes('coverage')
          ) {
            return;
          }

          const ext = path.extname(normalized);
          const validExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.sql'];
          if (!validExts.includes(ext)) {
            return;
          }

          // Debounce incremental swarm review
          if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
          }

          this.debounceTimer = setTimeout(() => {
            this.triggerIncrementalReview(normalized);
          }, this.debounceMs);
        }
      );

      this.broadcast({
        type: 'swarm:started',
        stage: 'watcher',
        detail: `Continuous IDE agent swarm watcher active on ${this.repoRoot}`,
      });
    } catch (err: unknown) {
      console.warn(`[SwarmWatcher] Watcher initialization warning: ${(err as Error).message}`);
    }
  }

  async triggerIncrementalReview(changedFilePath: string): Promise<ReviewFinding[]> {
    this.broadcast({
      type: 'swarm:review_started',
      stage: 'swarm',
      detail: `File save detected on ${changedFilePath}. Spawning lightweight review agent...`,
      payload: { filePath: changedFilePath },
    });

    try {
      const result = await this.orchestrator.runReview({ type: 'unstaged' });
      const fileFindings = result.findings.filter((f) =>
        f.filePath.replace(/\\/g, '/').endsWith(changedFilePath)
      );

      this.broadcast({
        type: 'swarm:review_completed',
        stage: 'swarm',
        detail: `Review finished for ${changedFilePath} (${fileFindings.length} findings).`,
        payload: {
          filePath: changedFilePath,
          findingsCount: fileFindings.length,
          findings: fileFindings,
        },
      });

      return fileFindings;
    } catch (err: unknown) {
      this.broadcast({
        type: 'swarm:error',
        stage: 'swarm',
        detail: `Swarm review error on ${changedFilePath}: ${(err as Error).message}`,
      });
      return [];
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    this.isRunning = false;
  }

  isActive(): boolean {
    return this.isRunning;
  }
}
