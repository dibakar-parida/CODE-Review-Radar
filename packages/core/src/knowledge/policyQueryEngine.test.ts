import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorage } from '../indexing/sqliteStorage.js';
import { MultiRepoKnowledgeBase } from './multiRepoKnowledgeBase.js';
import { PolicyQueryEngine } from './policyQueryEngine.js';

describe('PolicyQueryEngine', () => {
  let storage: SQLiteStorage;
  let kb: MultiRepoKnowledgeBase;
  let engine: PolicyQueryEngine;

  beforeEach(() => {
    storage = new SQLiteStorage({ dbPath: ':memory:' });
    kb = new MultiRepoKnowledgeBase({ storage, embeddingDim: 32 });

    // Seed knowledge base with security and architecture patterns
    kb.indexDocument({
      repoId: 'user-service',
      docId: 'sec:raw-sql',
      kind: 'finding',
      title: 'Parameterized Query Policy',
      content: 'All SQL database queries must use prepared statements ($1, $2) to eliminate SQL injection vulnerabilities. Raw template strings in db.query are strictly prohibited.',
      filePath: 'src/db/queries.ts',
    });

    kb.indexDocument({
      repoId: 'gateway',
      docId: 'arch:rate-limit',
      kind: 'rule',
      title: 'Gateway Rate Limiting Policy',
      content: 'Public API routes must be protected by Redis token bucket rate limiting (100 req/min per IP).',
      filePath: 'src/middleware/rateLimit.ts',
    });

    engine = new PolicyQueryEngine({ knowledgeBase: kb });
  });

  afterEach(() => {
    storage.close();
  });

  it('answers natural language policy questions citing matching modules', async () => {
    const result = await engine.ask('Are there any unescaped SQL queries or injection policies?');

    expect(result.query).toBe('Are there any unescaped SQL queries or injection policies?');
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations[0]!.repoId).toBe('user-service');
    expect(result.citations[0]!.filePath).toBe('src/db/queries.ts');
    expect(result.answer).toContain('Parameterized Query Policy');
  });

  it('handles out-of-domain queries when no matching policies exist', async () => {
    const result = await engine.ask('quantum-teleportation-crypto-protocol-xyz', {
      minSimilarity: 0.8,
    });

    expect(result.citations).toHaveLength(0);
    expect(result.answer).toContain('No matching code patterns, security policies, or architectural rules were found');
  });
});
