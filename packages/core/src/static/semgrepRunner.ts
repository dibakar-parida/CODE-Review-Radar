import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { ReviewFinding, ReviewSeverity, generateFindingId } from '@cr/shared';
import { normalizeToPosix } from '../git/diffParser.js';

const execFileAsync = promisify(execFile);

export interface SemgrepRunnerOptions {
  cwd?: string;
  timeoutMs?: number;
}

export class SemgrepRunner {
  private readonly cwd: string;
  private readonly timeoutMs: number;

  constructor(options: SemgrepRunnerOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.timeoutMs = options.timeoutMs ?? 45000;
  }

  async run(targetFilePaths: string[]): Promise<ReviewFinding[]> {
    if (targetFilePaths.length === 0) return [];

    try {
      const { stdout } = await execFileAsync(
        'semgrep',
        ['scan', '--json', '--quiet', ...targetFilePaths],
        {
          cwd: this.cwd,
          timeout: this.timeoutMs,
          windowsHide: true,
        }
      );

      return this.parseSemgrepOutput(stdout);
    } catch (err: unknown) {
      const error = err as { stdout?: string };
      if (error.stdout && error.stdout.trim().startsWith('{')) {
        return this.parseSemgrepOutput(error.stdout);
      }
      return [];
    }
  }

  parseSemgrepOutput(stdout: string): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    let count = 1;

    try {
      const parsed = JSON.parse(stdout) as {
        results?: Array<{
          check_id: string;
          path: string;
          start: { line: number };
          end: { line: number };
          extra?: {
            message?: string;
            severity?: string;
            lines?: string;
          };
        }>;
      };

      const results = parsed.results || [];
      for (const res of results) {
        const relative = normalizeToPosix(
          path.isAbsolute(res.path) ? path.relative(this.cwd, res.path) : res.path
        );

        let severity: ReviewSeverity = 'major';
        if (res.extra?.severity === 'ERROR') severity = 'critical';
        else if (res.extra?.severity === 'INFO') severity = 'info';

        findings.push({
          id: generateFindingId('security', count++),
          category: 'security',
          severity,
          confidence: 1.0,
          filePath: relative,
          startLine: res.start.line,
          endLine: res.end.line,
          title: `Semgrep Security Rule: ${res.check_id}`,
          explanation: res.extra?.message || `Semgrep finding for ${res.check_id}`,
          evidence: res.extra?.lines || '',
          verifiedBy: ['semgrep'],
        });
      }
    } catch {
      // Ignore parse failure
    }

    return findings;
  }
}
