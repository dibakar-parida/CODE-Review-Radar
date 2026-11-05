import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { ReviewFinding, generateFindingId } from '@cr/shared';
import { normalizeToPosix } from '../git/diffParser.js';

const execFileAsync = promisify(execFile);

export interface TscRunnerOptions {
  cwd?: string;
  timeoutMs?: number;
}

export class TscRunner {
  private readonly cwd: string;
  private readonly timeoutMs: number;

  constructor(options: TscRunnerOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async run(targetFilePaths: string[]): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];
    const targetSet = new Set(targetFilePaths.map((p) => normalizeToPosix(p)));

    try {
      // Execute tsc --noEmit --pretty false
      // In windows, tsc is typically in node_modules/.bin/tsc or npx
      const isWindows = process.platform === 'win32';
      const cmd = isWindows ? 'npx.cmd' : 'npx';

      const { stdout, stderr } = await execFileAsync(cmd, ['tsc', '--noEmit', '--pretty', 'false'], {
        cwd: this.cwd,
        timeout: this.timeoutMs,
        windowsHide: true,
      });

      const output = (stdout || '') + (stderr || '');
      return this.parseTscOutput(output, targetSet);
    } catch (err: unknown) {
      // tsc exits with code 2 on diagnostics, so stdout has the errors
      const error = err as { stdout?: string; stderr?: string };
      const output = (error.stdout || '') + (error.stderr || '');
      return this.parseTscOutput(output, targetSet);
    }
  }

  parseTscOutput(output: string, targetFilePaths: Set<string>): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    const lines = output.replace(/\r\n/g, '\n').split('\n');
    let count = 1;

    for (const line of lines) {
      // Regex format: filepath(line,col): error TSXXXX: Message
      const match = line.match(/^(.+?)\((\d+),(\d+)\):\s*error\s*(TS\d+):\s*(.+)$/);
      if (match) {
        const rawPath = match[1]!.trim();
        const lineNum = parseInt(match[2]!, 10);
        const code = match[4]!;
        const message = match[5]!.trim();

        // Convert path to relative POSIX
        const relative = normalizeToPosix(path.isAbsolute(rawPath) ? path.relative(this.cwd, rawPath) : rawPath);

        // Only include if in target files (or if target set is empty)
        if (targetFilePaths.size === 0 || targetFilePaths.has(relative)) {
          findings.push({
            id: generateFindingId('bug', count++),
            category: 'bug',
            severity: 'critical',
            confidence: 1.0,
            filePath: relative,
            startLine: lineNum,
            endLine: lineNum,
            title: `TypeScript Compiler Diagnostic: ${code}`,
            explanation: message,
            evidence: line,
            verifiedBy: ['tsc'],
          });
        }
      }
    }

    return findings;
  }
}
