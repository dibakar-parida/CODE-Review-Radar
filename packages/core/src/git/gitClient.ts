import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ReviewTarget, DiffReport } from '@cr/shared';
import { parseUnifiedDiff, calculateDiffStats } from './diffParser.js';

const execFileAsync = promisify(execFile);

export interface GitClientOptions {
  cwd?: string;
  maxBuffer?: number;
}

export class GitClient {
  private readonly cwd: string;
  private readonly maxBuffer: number;

  constructor(options: GitClientOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024; // 10MB
  }

  /**
   * Safe execution of git with argument array (zero raw shell interpolation).
   */
  async runGit(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: this.cwd,
        maxBuffer: this.maxBuffer,
        windowsHide: true,
      });
      return stdout;
    } catch (err: unknown) {
      const error = err as { message?: string; stderr?: string };
      throw new Error(`Git command failed [git ${args.join(' ')}]: ${error.stderr || error.message}`);
    }
  }

  /**
   * Fetches unified diff for a ReviewTarget.
   */
  async getDiff(target: ReviewTarget): Promise<DiffReport> {
    const args: string[] = ['diff', '--unified=3'];

    switch (target.type) {
      case 'staged':
        args.push('--cached');
        break;
      case 'unstaged':
        // git diff --unified=3 evaluates working directory changes vs index
        break;
      case 'commit':
        if (!target.ref) {
          throw new Error('Target type "commit" requires a target ref (e.g. HEAD, commit hash)');
        }
        args.push(`${target.ref}~1`, target.ref);
        break;
      case 'branch': {
        const base = target.baseRef || 'main';
        const head = target.ref || 'HEAD';
        args.push(`${base}...${head}`);
        break;
      }
      case 'files':
        if (target.paths && target.paths.length > 0) {
          args.push('--', ...target.paths);
        }
        break;
      default:
        throw new Error(`Unsupported review target type: ${(target as { type: string }).type}`);
    }

    // Append file filters if paths specified for non-files targets
    if (target.type !== 'files' && target.paths && target.paths.length > 0) {
      args.push('--', ...target.paths);
    }

    const rawDiff = await this.runGit(args);
    const files = parseUnifiedDiff(rawDiff);
    const { insertions, deletions } = calculateDiffStats(files);

    return {
      target,
      files,
      totalInsertions: insertions,
      totalDeletions: deletions,
    };
  }

  /**
   * Returns root directory of git repository.
   */
  async getRepoRoot(): Promise<string> {
    const output = await this.runGit(['rev-parse', '--show-toplevel']);
    return output.trim();
  }

  /**
   * Returns current git branch name or HEAD commit hash.
   */
  async getCurrentBranch(): Promise<string> {
    try {
      const output = await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
      const branch = output.trim();
      return branch === 'HEAD' ? 'main' : branch;
    } catch {
      return 'main';
    }
  }
}
