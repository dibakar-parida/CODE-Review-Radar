import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorage } from '../indexing/sqliteStorage.js';
import { MultiRepoKnowledgeBase } from './multiRepoKnowledgeBase.js';

describe('MultiRepoKnowledgeBase', () => {
  let storage: SQLiteStorage;
  let kb: MultiRepoKnowledgeBase;

  beforeEach(() => {
    storage = new SQLiteStorage({ dbPath: ':memory:' });
    kb = new MultiRepoKnowledgeBase({ storage, embeddingDim: 32 });
  });

  afterEach(() => {
    storage.close();
  });

  it('registers distinct repositories and tracks metadata', () => {
    kb.registerRepository('auth-service', 'Authentication Service', '/repos/auth');
    kb.registerRepository('billing-api', 'Billing & Invoicing API', '/repos/billing');

    const repos = kb.getRegisteredRepositories();
    expect(repos).toHaveLength(2);
    expect(repos.map((r) => r.id)).toContain('auth-service');
    expect(repos.map((r) => r.id)).toContain('billing-api');
  });

  it('generates unit-normalized embedding vectors deterministically', () => {
    const text1 = 'authenticate user with JWT bearer token and refresh rotation';
    const text2 = 'authenticate user with JWT bearer token and refresh rotation';
    const textDifferent = 'process recurring credit card payment charge';

    const v1 = kb.generateEmbedding(text1);
    const v2 = kb.generateEmbedding(text2);
    const vDiff = kb.generateEmbedding(textDifferent);

    expect(v1).toHaveLength(32);
    expect(v1).toEqual(v2);

    // Compute norm of v1: should be ~1.0
    let norm = 0;
    for (const val of v1) {
      norm += val * val;
    }
    expect(Math.abs(Math.sqrt(norm) - 1.0)).toBeLessThan(0.01);

    // Cosine similarity between identical texts is 1.0
    const simIdentical = storage.computeCosineSimilarity(v1, v2);
    expect(simIdentical).toBeCloseTo(1.0, 3);

    // Cosine similarity to different text is lower
    const simDifferent = storage.computeCosineSimilarity(v1, vDiff);
    expect(simDifferent).toBeLessThan(simIdentical);
  });

  it('indexes code patterns and retrieves relevant cross-service documents via similarity search', () => {
    // Index document in service A (auth)
    kb.indexDocument({
      repoId: 'auth-service',
      docId: 'sym:verifyToken',
      kind: 'symbol',
      title: 'verifyToken',
      content: 'function verifyToken(token: string): JwtPayload { return jwt.verify(token, secret); }',
      filePath: 'src/jwt.ts',
    });

    // Index document in service B (billing)
    kb.indexDocument({
      repoId: 'billing-api',
      docId: 'sym:chargeCustomer',
      kind: 'symbol',
      title: 'chargeCustomer',
      content: 'async function chargeCustomer(customerId: string, amount: number) { await stripe.charges.create(...); }',
      filePath: 'src/stripe.ts',
    });

    // Search for JWT / authentication
    const authResults = kb.search('jwt verification token security');
    expect(authResults.length).toBeGreaterThan(0);
    expect(authResults[0]!.repoId).toBe('auth-service');
    expect(authResults[0]!.title).toBe('verifyToken');

    // Search for payment / charge
    const billingResults = kb.search('stripe payment charge customer');
    expect(billingResults.length).toBeGreaterThan(0);
    expect(billingResults[0]!.repoId).toBe('billing-api');
    expect(billingResults[0]!.title).toBe('chargeCustomer');
  });
});
