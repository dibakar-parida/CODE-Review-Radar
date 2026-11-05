import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import {
  ReviewTarget,
  ReviewTargetType,
  ReporterFormat,
  ReviewResult,
} from '@cr/shared';
import {
  UnifiedReviewOrchestrator,
  TerminalReporter,
  JsonReporter,
  MarkdownReporter,
  HtmlReporter,
} from '@cr/core';

export interface ReviewCommandOptions {
  target?: string;
  ref?: string;
  base?: string;
  format?: string;
  config?: string;
  output?: string;
  failOnCritical?: boolean;
}

export function createReviewCommand(): Command {
  const review = new Command('review')
    .description('Run local-first AI code review on git changes')
    .option(
      '-t, --target <type>',
      'Target changes to review (staged, unstaged, commit, branch, files)',
      'staged'
    )
    .option('-r, --ref <ref>', 'Target git commit hash or branch ref')
    .option('-b, --base <base>', 'Base branch for comparison (defaults to main)', 'main')
    .option(
      '-f, --format <format>',
      'Output format (terminal, json, markdown, html)',
      'terminal'
    )
    .option('-c, --config <path>', 'Custom path to .cr.yaml config')
    .option('-o, --output <file>', 'Save report output directly to a file')
    .option('--fail-on-critical', 'Exit with non-zero exit code if critical findings are detected', false)
    .action(async (options: ReviewCommandOptions) => {
      try {
        const targetType = (options.target || 'staged') as ReviewTargetType;
        const target: ReviewTarget = {
          type: targetType,
          ref: options.ref,
          baseRef: options.base,
        };

        const orchestrator = new UnifiedReviewOrchestrator({
          cwd: process.cwd(),
          configPath: options.config,
        });

        const result: ReviewResult = await orchestrator.runReview(target);
        const format = (options.format || 'terminal') as ReporterFormat;

        let formattedOutput = '';
        switch (format) {
          case 'json':
            formattedOutput = new JsonReporter().format(result);
            break;
          case 'markdown':
            formattedOutput = new MarkdownReporter().format(result);
            break;
          case 'html':
            formattedOutput = new HtmlReporter().format(result);
            break;
          case 'terminal':
          default:
            formattedOutput = new TerminalReporter().format(result);
            break;
        }

        if (options.output) {
          await fs.writeFile(options.output, formattedOutput, 'utf-8');
          console.log(`\n✔ Report saved to ${options.output}`);
        } else {
          console.log(formattedOutput);
        }

        if (options.failOnCritical && (result.summary.bySeverity.critical ?? 0) > 0) {
          process.exit(1);
        }
      } catch (err: unknown) {
        console.error(`\n✖ Error during cr review: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return review;
}
