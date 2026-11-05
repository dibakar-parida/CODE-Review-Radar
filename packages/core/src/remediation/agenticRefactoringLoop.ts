import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ReviewFinding } from '@cr/shared';
import { AtomicTransactionManager, VerificationOptions } from './transactionManager.js';

export interface RepairContext {
  filePath: string;
  originalCode: string;
  failedPatch: string;
  compilerError: string;
  attempt: number;
  finding: ReviewFinding;
}

export interface RepairAttemptLog {
  attempt: number;
  patch: string;
  error?: string;
  success: boolean;
}

export interface AgenticRepairResult {
  success: boolean;
  attempts: number;
  history: RepairAttemptLog[];
  finalPatch?: string;
  error?: string;
  committed: boolean;
  rolledBack: boolean;
}

export interface AgenticRefactorOptions {
  repoRoot?: string;
  maxAttempts?: number;
  verificationOptions?: VerificationOptions;
  customVerify?: (filePath: string, content: string) => Promise<boolean | { success: boolean; error?: string }>;
  repairFn?: (context: RepairContext) => Promise<string>;
}

export class AgenticRefactoringLoop {
  private readonly repoRoot: string;
  private readonly maxAttempts: number;
  private readonly verificationOptions?: VerificationOptions;
  private readonly customVerify?: (filePath: string, content: string) => Promise<boolean | { success: boolean; error?: string }>;
  private readonly customRepairFn?: (context: RepairContext) => Promise<string>;

  constructor(options: AgenticRefactorOptions = {}) {
    this.repoRoot = options.repoRoot ?? process.cwd();
    this.maxAttempts = options.maxAttempts ?? 3;
    this.verificationOptions = options.verificationOptions;
    this.customVerify = options.customVerify;
    this.customRepairFn = options.repairFn;
  }

  /**
   * Applies patch with autonomous verification & multi-step repair feedback loop.
   */
  async executeLoop(
    filePath: string,
    initialPatch: string,
    finding: ReviewFinding
  ): Promise<AgenticRepairResult> {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.repoRoot, filePath);

    let originalCode = '';
    try {
      originalCode = await fs.readFile(fullPath, 'utf-8');
    } catch {
      // If new file, original is empty
    }

    const history: RepairAttemptLog[] = [];
    let currentPatch = initialPatch;
    let lastError = '';

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const tx = new AtomicTransactionManager(this.repoRoot);
      try {
        // Step 1: Snapshot and apply candidate patch
        await tx.applyPatchToFile(filePath, currentPatch);

        // Step 2: Run deterministic compiler / custom verification
        let isSuccess = true;
        let errorMessage = '';

        if (this.customVerify) {
          const patched = await fs.readFile(fullPath, 'utf-8');
          const res = await this.customVerify(filePath, patched);
          if (typeof res === 'boolean') {
            isSuccess = res;
            if (!res) errorMessage = 'Custom verification check returned false';
          } else {
            isSuccess = res.success;
            errorMessage = res.error || '';
          }
        } else {
          const verifyResult = await tx.verifyAndCommit(this.verificationOptions ?? { runTypecheck: true });
          isSuccess = verifyResult.success;
          errorMessage = verifyResult.error || '';
        }

        if (isSuccess) {
          await tx.verifyAndCommit(); // commit transaction
          history.push({
            attempt,
            patch: currentPatch,
            success: true,
          });

          return {
            success: true,
            attempts: attempt,
            history,
            finalPatch: currentPatch,
            committed: true,
            rolledBack: false,
          };
        }

        // Step 3: Capture verification error
        lastError = errorMessage || 'Verification check failed';
        history.push({
          attempt,
          patch: currentPatch,
          error: lastError,
          success: false,
        });

        // Roll back candidate patch before next iteration
        await tx.rollback();

        // Step 4: If attempts remaining, autonomously synthesize corrected patch
        if (attempt < this.maxAttempts) {
          currentPatch = await this.generateRepairedPatch({
            filePath,
            originalCode,
            failedPatch: currentPatch,
            compilerError: lastError,
            attempt,
            finding,
          });
        }
      } catch (err: unknown) {
        lastError = (err as Error).message;
        await tx.rollback();
        history.push({
          attempt,
          patch: currentPatch,
          error: lastError,
          success: false,
        });
      }
    }

    // All attempts exhausted: fully rolled back
    return {
      success: false,
      attempts: this.maxAttempts,
      history,
      error: lastError,
      committed: false,
      rolledBack: true,
    };
  }

  /**
   * Generates a repaired patch informed by compiler error diagnostics.
   */
  private async generateRepairedPatch(context: RepairContext): Promise<string> {
    if (this.customRepairFn) {
      return this.customRepairFn(context);
    }

    // Default heuristic repair:
    // If TS error notes "is possibly 'undefined'" or "possibly 'null'", inject optional chaining / guard
    if (
      context.compilerError.includes('possibly \'undefined\'') ||
      context.compilerError.includes('possibly \'null\'')
    ) {
      return context.failedPatch
        .replace(/(\w+)\.(\w+)/g, '$1?.$2');
    }

    // If TS error notes type mismatch or implicit any, add type assertion or fallback
    if (context.compilerError.includes('Type') && context.compilerError.includes('is not assignable')) {
      return context.failedPatch.replace(/;\s*$/, ' as any;\n');
    }

    // Return original patch if no heuristic applies
    return context.failedPatch;
  }
}
