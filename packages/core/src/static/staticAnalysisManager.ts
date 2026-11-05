import { ReviewFinding, StaticAnalysisConfig } from '@cr/shared';
import { TscRunner } from './tscRunner.js';
import { EslintRunner } from './eslintRunner.js';
import { SemgrepRunner } from './semgrepRunner.js';

export interface StaticAnalysisManagerOptions {
  cwd?: string;
  config?: StaticAnalysisConfig;
  tscRunner?: TscRunner;
  eslintRunner?: EslintRunner;
  semgrepRunner?: SemgrepRunner;
}

export class StaticAnalysisManager {
  private readonly tscRunner: TscRunner;
  private readonly eslintRunner: EslintRunner;
  private readonly semgrepRunner: SemgrepRunner;
  private readonly config: StaticAnalysisConfig;

  constructor(options: StaticAnalysisManagerOptions = {}) {
    const cwd = options.cwd ?? process.cwd();
    this.tscRunner = options.tscRunner ?? new TscRunner({ cwd });
    this.eslintRunner = options.eslintRunner ?? new EslintRunner({ cwd });
    this.semgrepRunner = options.semgrepRunner ?? new SemgrepRunner({ cwd });
    this.config = options.config ?? {
      enableTsc: true,
      enableEslint: true,
      enableSemgrep: true,
    };
  }

  /**
   * Runs all enabled static analysis tools concurrently across the modified files.
   */
  async runAll(targetFilePaths: string[]): Promise<ReviewFinding[]> {
    if (targetFilePaths.length === 0) {
      return [];
    }

    const tasks: Promise<ReviewFinding[]>[] = [];

    if (this.config.enableTsc) {
      tasks.push(
        this.tscRunner.run(targetFilePaths).catch((err) => {
          console.warn(`[static-analysis] TSC runner failed: ${(err as Error).message}`);
          return [];
        })
      );
    }

    if (this.config.enableEslint) {
      tasks.push(
        this.eslintRunner.run(targetFilePaths).catch((err) => {
          console.warn(`[static-analysis] ESLint runner failed: ${(err as Error).message}`);
          return [];
        })
      );
    }

    if (this.config.enableSemgrep) {
      tasks.push(
        this.semgrepRunner.run(targetFilePaths).catch((err) => {
          console.warn(`[static-analysis] Semgrep runner failed: ${(err as Error).message}`);
          return [];
        })
      );
    }

    const results = await Promise.allSettled(tasks);
    const combined: ReviewFinding[] = [];

    for (const r of results) {
      if (r.status === 'fulfilled') {
        combined.push(...r.value);
      }
    }

    return combined;
  }
}
