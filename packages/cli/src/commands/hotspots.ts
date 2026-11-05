import { Command } from 'commander';
import { GitChurnAnalyzer } from '@cr/core';

export function createHotspotsCommand(): Command {
  const cmd = new Command('hotspots');

  cmd
    .description('Analyze git commit history to detect high-churn volatility hotspots')
    .option('-m, --max <commits>', 'Maximum number of recent commits to inspect', '100')
    .action(async (options: { max?: string }) => {
      try {
        const maxCommits = parseInt(options.max || '100', 10);
        console.log(`⚡ Analyzing Git commit churn volatility (last ${maxCommits} commits)...`);

        const analyzer = new GitChurnAnalyzer({ cwd: process.cwd(), maxCommits });
        const metrics = await analyzer.analyzeChurn();

        if (metrics.length === 0) {
          console.log('ℹ No commit churn detected in this repository.');
          return;
        }

        console.log('\n🔥 REPOSITORY HOTSPOTS (BY DESCENDING CHURN SCORE):\n');
        for (const m of metrics.slice(0, 10)) {
          const badge = m.isHotspot ? '[HIGH VOLATILITY]' : '[NORMAL]';
          console.log(
            `  • ${m.filePath.padEnd(40)} | Score: ${m.churnScore.toString().padEnd(6)} | ${m.commitCount} commits | +${m.linesAdded}/-${m.linesDeleted} ${badge}`
          );
        }
        console.log('');
      } catch (err: unknown) {
        console.error(`✖ Hotspots analysis failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return cmd;
}
