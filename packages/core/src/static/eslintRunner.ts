import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { ReviewFinding, ReviewSeverity, generateFindingId } from '@cr/shared';
import { normalizeToPosix } from '../git/diffParser.js';

const execFileAsync = promisify(execFile);

export interface EslintRunnerOptions {
  cwd?: string;
  timeoutMs?: number;
}

export class EslintRunner {
  private readonly cwd: string;
  private readonly timeoutMs: number;

  constructor(options: EslintRunnerOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async run(targetFilePaths: string[]): Promise<ReviewFinding[]> {
    if (targetFilePaths.length === 0) return [];

    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'npx.cmd' : 'npx';

    try {
      const { stdout } = await execFileAsync(
        cmd,
        ['eslint', '--format', 'json', ...targetFilePaths],
        {
          cwd: this.cwd,
          timeout: this.timeoutMs,
          windowsHide: true,
        }
      );

      return this.parseEslintOutput(stdout);
    } catch (err: unknown) {
      // ESLint exits with 1 when lint errors exist, stdout contains JSON
      const error = err as { stdout?: string };
      if (error.stdout && error.stdout.trim().startsWith('[')) {
        return this.parseEslintOutput(error.stdout);
      }
      return [];
    }
  }

  parseEslintOutput(stdout: string): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    let count = 1;

    try {
      const reports = JSON.parse(stdout) as Array<{
        filePath: string;
        messages: Array<{
          ruleId: string | null;
          severity: number;
          message: string;
          line: number;
          endLine?: number;
        }>;
      }>;

      for (const report of reports) {
        const relative = normalizeToPosix(
          path.isAbsolute(report.filePath) ? path.relative(this.cwd, report.filePath) : report.filePath
        );

        for (const msg of report.messages) {
          const severity: ReviewSeverity = msg.severity === 2 ? 'major' : 'minor';
          findings.push({
            id: generateFindingId('quality', count++),
            category: 'quality',
            severity,
            confidence: 1.0,
            filePath: relative,
            startLine: msg.line,
            endLine: msg.endLine || msg.line,
            title: `ESLint Violation: ${msg.ruleId || 'syntax'}`,
            explanation: msg.message,
            evidence: `${relative}:${msg.line} - [${msg.ruleId || 'lint'}]`,
            verifiedBy: ['eslint'],
          });
        }
      }
    } catch {
      // Not valid json
    }

    return findings;
  }
}
