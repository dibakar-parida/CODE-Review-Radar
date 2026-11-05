import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import {
  WebhookEmulator,
  UnifiedReviewOrchestrator,
  GitClient,
} from '@cr/core';
import { WebhookCheckRunResponse } from '@cr/shared';

export interface WebhookCommandOptions {
  event?: string;
  branch?: string;
  base?: string;
  format?: string;
  output?: string;
  config?: string;
  failOnCritical?: boolean;
}

export function formatCheckRunTerminal(checkRun: WebhookCheckRunResponse): string {
  const lines: string[] = [];
  const statusColor =
    checkRun.conclusion === 'success'
      ? '\x1b[32m✔ SUCCESS\x1b[0m'
      : '\x1b[31m✖ FAILURE\x1b[0m';

  lines.push('================================================================================');
  lines.push(`🤖 CI/CD WEBHOOK EMULATOR`);
  lines.push(`STATUS: ${checkRun.status.toUpperCase()}  |  CONCLUSION: ${statusColor}`);
  lines.push('================================================================================');
  lines.push(checkRun.title);
  lines.push('');
  lines.push(checkRun.summary);
  lines.push('');

  if (checkRun.annotations.length > 0) {
    lines.push(`📝 Annotations (${checkRun.annotations.length}):`);
    lines.push('--------------------------------------------------------------------------------');
    for (const ann of checkRun.annotations) {
      const levelColor =
        ann.annotation_level === 'failure'
          ? '\x1b[31m[FAILURE]\x1b[0m'
          : ann.annotation_level === 'warning'
            ? '\x1b[33m[WARNING]\x1b[0m'
            : '\x1b[36m[NOTICE]\x1b[0m';
      lines.push(`${levelColor} ${ann.path}:${ann.start_line}-${ann.end_line} - ${ann.title}`);
      lines.push(`  Message: ${ann.message}`);
      if (ann.raw_details) {
        lines.push(`  Details: ${ann.raw_details.split('\n')[0]}`);
      }
      lines.push('');
    }
  }

  lines.push('================================================================================');
  return lines.join('\n');
}

export function createWebhookCommand(): Command {
  const webhook = new Command('webhook')
    .alias('ci')
    .description('Simulate a local GitHub/GitLab CI/CD webhook review run')
    .argument('[payloadFile]', 'Path to incoming webhook JSON payload file')
    .option('-e, --event <event>', 'Webhook event name (e.g. pull_request.opened, push)', 'pull_request.opened')
    .option('-b, --branch <branch>', 'Branch to evaluate')
    .option('--base <base>', 'Base branch (default: main)', 'main')
    .option('-f, --format <format>', 'Output format (terminal, json)', 'terminal')
    .option('-o, --output <file>', 'Save check run output to file')
    .option('-c, --config <path>', 'Custom path to .cr.yaml config')
    .option('--fail-on-critical', 'Exit with code 1 if check run fails', false)
    .action(async (payloadFileArg: string | undefined, options: WebhookCommandOptions) => {
      try {
        let rawPayload: Record<string, any> = {};

        if (payloadFileArg) {
          const content = await fs.readFile(payloadFileArg, 'utf-8');
          rawPayload = JSON.parse(content);
        } else {
          const git = new GitClient();
          const currentBranch = options.branch || (await git.getCurrentBranch().catch(() => 'HEAD'));
          rawPayload = {
            action: options.event?.includes('.') ? options.event.split('.')[1] : 'opened',
            pull_request: {
              head: { ref: currentBranch },
              base: { ref: options.base || 'main' },
              number: 42,
            },
            repository: {
              full_name: 'local-org/code-review-sim',
            },
          };
        }

        const event = WebhookEmulator.parsePayload(rawPayload, {
          'x-github-event': options.event || 'pull_request',
        });

        console.log(`⚡ Processing Webhook: [${event.provider.toUpperCase()}] ${event.event} for ${event.branch} ➔ ${event.baseBranch}...`);

        const orchestrator = new UnifiedReviewOrchestrator({
          cwd: process.cwd(),
          configPath: options.config,
        });

        const result = await orchestrator.runReview({
          type: 'branch',
          ref: event.branch,
          baseRef: event.baseBranch,
        });

        const checkRun = WebhookEmulator.formatCheckRun(event, result);
        const format = options.format || 'terminal';
        let formattedOutput = '';

        if (format === 'json') {
          formattedOutput = JSON.stringify(checkRun, null, 2);
        } else {
          formattedOutput = formatCheckRunTerminal(checkRun);
        }

        if (options.output) {
          await fs.writeFile(options.output, formattedOutput, 'utf-8');
          console.log(`✔ CI Webhook check run output written to ${options.output}`);
        } else {
          console.log(formattedOutput);
        }

        if (options.failOnCritical && checkRun.conclusion === 'failure') {
          process.exit(1);
        }
      } catch (err: unknown) {
        console.error(`✖ Webhook simulation error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return webhook;
}
