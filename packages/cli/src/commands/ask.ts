import { Command } from 'commander';
import {
  RepositoryIndexer,
  MultiRepoKnowledgeBase,
  PolicyQueryEngine,
} from '@cr/core';

export interface AskCommandOptions {
  repo?: string;
  limit?: string;
  format?: string;
}

export function formatAskTerminal(result: {
  query: string;
  answer: string;
  citations: Array<{ repoId: string; filePath: string; title: string; similarity: number; snippet: string }>;
  confidence: number;
  modelUsed: string;
}): string {
  const lines: string[] = [];

  lines.push('================================================================================');
  lines.push(`💬 POLICY & ARCHITECTURE QUERY: "${result.query}"`);
  lines.push(`CONFIDENCE: ${Math.round(result.confidence * 100)}%  |  ENGINE: ${result.modelUsed}`);
  lines.push('================================================================================');
  lines.push('');
  lines.push(result.answer);
  lines.push('');

  if (result.citations.length > 0) {
    lines.push(`📚 Relevant Citations & Codebase Evidence (${result.citations.length}):`);
    lines.push('--------------------------------------------------------------------------------');
    for (const c of result.citations) {
      lines.push(`\x1b[36m[${c.repoId}]\x1b[0m \x1b[1m${c.filePath}\x1b[0m (Similarity: ${Math.round(c.similarity * 100)}%)`);
      lines.push(`  Title:   ${c.title}`);
      lines.push(`  Snippet: ${c.snippet.replace(/\n/g, ' ')}`);
      lines.push('');
    }
  }

  lines.push('================================================================================');
  return lines.join('\n');
}

export function createAskCommand(): Command {
  const ask = new Command('ask')
    .description('Query multi-repo vector knowledge base using natural language and local reasoning')
    .argument('<query>', 'Natural language policy, architecture, or security query')
    .option('-r, --repo <repo>', 'Target specific repository ID')
    .option('-l, --limit <limit>', 'Maximum number of citations to retrieve', '5')
    .option('-f, --format <format>', 'Output format (terminal, json, markdown)', 'terminal')
    .action(async (query: string, options: AskCommandOptions) => {
      try {
        const indexer = new RepositoryIndexer({ repoRoot: process.cwd() });
        const storage = indexer.getStorage();
        const kb = new MultiRepoKnowledgeBase({ storage });
        const engine = new PolicyQueryEngine({ knowledgeBase: kb });

        const limit = parseInt(options.limit || '5', 10);
        const result = await engine.ask(query, {
          repoId: options.repo,
          limit,
        });

        const format = options.format || 'terminal';
        if (format === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else if (format === 'markdown') {
          console.log(`# Policy Query: ${result.query}\n\n${result.answer}\n\n### Citations:\n` +
            result.citations.map((c) => `- **[${c.repoId}] ${c.filePath}:** ${c.title}`).join('\n')
          );
        } else {
          console.log(formatAskTerminal(result));
        }
      } catch (err: unknown) {
        console.error(`✖ Policy query failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return ask;
}
