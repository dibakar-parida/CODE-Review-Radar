import { describe, it, expect } from 'vitest';
import { formatAskTerminal } from './ask.js';

describe('Policy Query CLI (cr ask)', () => {
  it('formats terminal output with citations and confidence metrics', () => {
    const mockResult = {
      query: 'Are there any unescaped SQL queries across our services?',
      answer: 'All services enforce parameterized queries via PreparedStatements.',
      citations: [
        {
          repoId: 'billing-api',
          filePath: 'src/db/client.ts',
          title: 'Safe Query Wrapper',
          similarity: 0.94,
          snippet: 'export function query(sql: string, params: any[]) { ... }',
        },
      ],
      confidence: 0.95,
      modelUsed: 'knowledge-retrieval-v1',
    };

    const output = formatAskTerminal(mockResult);

    expect(output).toContain('POLICY & ARCHITECTURE QUERY');
    expect(output).toContain('CONFIDENCE: 95%');
    expect(output).toContain('All services enforce parameterized queries');
    expect(output).toContain('Relevant Citations & Codebase Evidence (1):');
    expect(output).toContain('[billing-api]');
    expect(output).toContain('src/db/client.ts');
  });
});
