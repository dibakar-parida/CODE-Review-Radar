import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PatchGenerator } from './patchGenerator.js';
import { normalizeToPosix } from '../git/diffParser.js';

const execFileAsync = promisify(execFile);

export interface VerificationOptions {
  runTypecheck?: boolean;
  testCommand?: { cmd: string; args: string[] };
  customVerify?: () => Promise<boolean>;
}

export interface FileSnapshot {
  relativePath: string;
  originalContent: string;
}

export type TransactionStatus = 'pending' | 'applied' | 'verified' | 'committed' | 'rolled_back';

export class AtomicTransactionManager {
  private readonly repoRoot: string;
  private readonly patchGen: PatchGenerator;
  private readonly snapshots = new Map<string, FileSnapshot>();
  private status: TransactionStatus = 'pending';
  private snapshotDir: string | null = null;

  constructor(repoRoot: string = process.cwd()) {
    this.repoRoot = repoRoot;
    this.patchGen = new PatchGenerator();
  }

  getStatus(): TransactionStatus {
    return this.status;
  }

  /**
   * Captures a backup snapshot of the target file before modifying it.
   */
  async snapshotFile(relativePath: string): Promise<void> {
    const posix = normalizeToPosix(relativePath);
    if (this.snapshots.has(posix)) return;

    const absPath = path.resolve(this.repoRoot, posix);
    let originalContent = '';
    try {
      originalContent = await fs.readFile(absPath, 'utf-8');
    } catch {
      // File did not exist (e.g. creating new file)
      originalContent = '';
    }

    this.snapshots.set(posix, {
      relativePath: posix,
      originalContent,
    });

    // Also persist snapshot to .cr/snapshots/ if in a repo
    try {
      const crDir = path.join(this.repoRoot, '.cr', 'snapshots', Date.now().toString());
      await fs.mkdir(crDir, { recursive: true });
      this.snapshotDir = crDir;
      const backupPath = path.join(crDir, posix.replace(/\//g, '__'));
      await fs.writeFile(backupPath, originalContent, 'utf-8');
    } catch {
      // Ignore if .cr cannot be written
    }
  }

  /**
   * Applies a patch to a file inside the transaction boundary.
   */
  async applyPatchToFile(relativePath: string, patchText: string): Promise<string> {
    const posix = normalizeToPosix(relativePath);
    await this.snapshotFile(posix);

    const absPath = path.resolve(this.repoRoot, posix);
    const originalContent = this.snapshots.get(posix)!.originalContent;
    const patchedContent = this.patchGen.applyPatch(originalContent, patchText);

    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, patchedContent, 'utf-8');
    this.status = 'applied';

    return patchedContent;
  }

  /**
   * Writes content directly to a file inside the transaction boundary.
   */
  async writeFileWithSnapshot(relativePath: string, newContent: string): Promise<void> {
    const posix = normalizeToPosix(relativePath);
    await this.snapshotFile(posix);

    const absPath = path.resolve(this.repoRoot, posix);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, newContent, 'utf-8');
    this.status = 'applied';
  }

  /**
   * Executes verification (typecheck + targeted tests).
   * Automatically rolls back all files if verification fails!
   */
  async verifyAndCommit(options: VerificationOptions = {}): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. Run typecheck if requested
      if (options.runTypecheck) {
        const isWin = process.platform === 'win32';
        const cmd = isWin ? 'npx.cmd' : 'npx';
        try {
          await execFileAsync(cmd, ['tsc', '--noEmit'], {
            cwd: this.repoRoot,
            windowsHide: true,
          });
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string };
          throw new Error(`TypeScript verification failed:\n${e.stdout || e.stderr || ''}`);
        }
      }

      // 2. Run targeted test command if specified
      if (options.testCommand) {
        try {
          await execFileAsync(options.testCommand.cmd, options.testCommand.args, {
            cwd: this.repoRoot,
            windowsHide: true,
          });
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string };
          throw new Error(`Targeted test verification failed:\n${e.stdout || e.stderr || ''}`);
        }
      }

      // 3. Custom verification hook
      if (options.customVerify) {
        const customPassed = await options.customVerify();
        if (!customPassed) {
          throw new Error('Custom verification check returned false');
        }
      }

      this.status = 'committed';
      return { success: true };
    } catch (err: unknown) {
      const errorMsg = (err as Error).message;
      // Verification failed! Trigger atomic rollback
      await this.rollback();
      return {
        success: false,
        error: `Verification failed! All files safely restored to snapshot.\nReason: ${errorMsg}`,
      };
    }
  }

  /**
   * Restores all snapshot files to their exact original state.
   */
  async rollback(): Promise<void> {
    for (const [posix, snapshot] of this.snapshots.entries()) {
      const absPath = path.resolve(this.repoRoot, posix);
      if (snapshot.originalContent === '') {
        // File didn't exist before, remove created file
        try {
          await fs.rm(absPath, { force: true });
        } catch {
          // Ignore
        }
      } else {
        await fs.writeFile(absPath, snapshot.originalContent, 'utf-8');
      }
    }
    this.status = 'rolled_back';
  }
}
