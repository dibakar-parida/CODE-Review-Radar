import { Command } from 'commander';
import { createReviewCommand } from './commands/review.js';
import { createFixCommand } from './commands/fix.js';
import { createHookCommand } from './commands/hook.js';
import { createPrCommand } from './commands/pr.js';
import { createWebhookCommand } from './commands/webhook.js';
import { createAskCommand } from './commands/ask.js';
import { RepositoryIndexer } from '@cr/core';
import { LocalReviewServer } from '@cr/server';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('cr')
    .description('cr — Local-First AI Code Review System')
    .version('0.1.0');

  // Phase 1 Active Command: cr review
  program.addCommand(createReviewCommand());

  // Phase 4 Active Command: cr fix
  program.addCommand(createFixCommand());

  // Phase 6 Active Command: cr hook
  program.addCommand(createHookCommand());

  // Phase 7 Active Command: cr pr
  program.addCommand(createPrCommand());

  // Phase 8 Active Command: cr webhook / cr ci
  program.addCommand(createWebhookCommand());

  // Phase 9 Active Command: cr ask
  program.addCommand(createAskCommand());

  // Phase 3 Active Command: cr index
  program
    .command('index')
    .description('Index repository AST symbols, call graphs, and blast radius metadata')
    .action(async () => {
      try {
        console.log('⚡ Indexing repository AST symbols & call graph into .cr/index.db...');
        const indexer = new RepositoryIndexer({ repoRoot: process.cwd() });
        const stats = await indexer.indexRepository();
        console.log(`✔ Indexed ${stats.indexedFiles} files (${stats.skippedFiles} up-to-date, ${stats.deletedFiles} purged) in ${stats.durationMs}ms`);
      } catch (err: unknown) {
        console.error(`✖ Indexing failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  // Phase 5 Active Command: cr serve
  program
    .command('serve')
    .description('Start local dashboard & WebSocket server on 127.0.0.1')
    .option('-p, --port <port>', 'Port to bind server', '3100')
    .action(async (options: { port?: string }) => {
      try {
        const port = parseInt(options.port || '3100', 10);
        const server = new LocalReviewServer({
          port,
          host: '127.0.0.1',
          repoRoot: process.cwd(),
        });
        const info = await server.start();
        console.log(`⚡ cr review server live at http://${info.host}:${info.port}`);
        console.log(`⚡ WebSocket progress stream connected at ws://${info.host}:${info.port}/events/progress`);
      } catch (err: unknown) {
        console.error(`✖ Server failed to start: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return program;
}

export { createReviewCommand };
