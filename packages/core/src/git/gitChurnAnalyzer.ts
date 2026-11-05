import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface FileChurnMetric {
  filePath: string;
  commitCount: number;
  linesAdded: number;
  linesDeleted: number;
  totalChanges: number;
  churnScore: number;
  isHotspot: boolean;
}

export interface ChurnAnalysisOptions {
  cwd?: string;
  maxCommits?: number;
  hotspotThresholdPercentile?: number; // e.g., top 15%
}

export class GitChurnAnalyzer {
  private readonly cwd: string;

  constructor(options: ChurnAnalysisOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
  }

  /**
   * Parses git log history to calculate file commit frequency and churn volatility.
   */
  async analyzeChurn(options: ChurnAnalysisOptions = {}): Promise<FileChurnMetric[]> {
    const maxCommits = options.maxCommits ?? 100;
    const cwd = options.cwd ?? this.cwd;

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['log', `-${maxCommits}`, '--numstat', '--pretty=format:COMMIT:%H'],
        { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
      );

      return this.parseNumstat(stdout, options.hotspotThresholdPercentile ?? 0.85);
    } catch {
      // If git log fails (e.g. shallow repo, no commits, or git not initialized)
      return [];
    }
  }

  /**
   * Internal parser for git log --numstat output.
   */
  parseNumstat(output: string, hotspotThresholdPercentile: number = 0.85): FileChurnMetric[] {
    const fileStats = new Map<
      string,
      { commits: Set<string>; added: number; deleted: number }
    >();

    const lines = output.split('\n');
    let currentCommit = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('COMMIT:')) {
        currentCommit = line.slice(7);
        continue;
      }

      // numstat format: <added>\t<deleted>\t<path>
      const parts = line.split('\t');
      if (parts.length < 3) continue;

      const addedStr = parts[0]!;
      const deletedStr = parts[1]!;
      const filePath = parts[2]!.trim();

      // Binary files show "-" in numstat
      const added = addedStr === '-' ? 0 : parseInt(addedStr, 10) || 0;
      const deleted = deletedStr === '-' ? 0 : parseInt(deletedStr, 10) || 0;

      if (!fileStats.has(filePath)) {
        fileStats.set(filePath, {
          commits: new Set(),
          added: 0,
          deleted: 0,
        });
      }

      const stat = fileStats.get(filePath)!;
      if (currentCommit) stat.commits.add(currentCommit);
      stat.added += added;
      stat.deleted += deleted;
    }

    const metrics: FileChurnMetric[] = [];
    for (const [filePath, data] of fileStats.entries()) {
      const commitCount = data.commits.size;
      const totalChanges = data.added + data.deleted;
      // Churn score: commit frequency scaled logarithmically by line volatility
      const churnScore = Math.round(commitCount * Math.log2(totalChanges + 2) * 10) / 10;

      metrics.push({
        filePath,
        commitCount,
        linesAdded: data.added,
        linesDeleted: data.deleted,
        totalChanges,
        churnScore,
        isHotspot: false,
      });
    }

    metrics.sort((a, b) => b.churnScore - a.churnScore);

    // Mark top percentile as hotspots
    if (metrics.length > 0) {
      const hotspotCount = Math.max(1, Math.ceil(metrics.length * (1 - hotspotThresholdPercentile)));
      for (let i = 0; i < Math.min(hotspotCount, metrics.length); i++) {
        metrics[i]!.isHotspot = true;
      }
    }

    return metrics;
  }
}
