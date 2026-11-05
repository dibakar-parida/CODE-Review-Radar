import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider, AnthropicProvider } from './provider.js';
import { FileDiff, ReviewConfigSchema } from '@cr/shared';

describe('Cloud Provider Adapters (OpenAI & Anthropic)', () => {
  const dummyDiff: FileDiff = {
    oldPath: 'src/main.ts',
    newPath: 'src/main.ts',
    status: 'modified',
    raw: '@@ -1,2 +1,3 @@\n-old\n+new\n',
    hunks: [],
  };

  const config = ReviewConfigSchema.parse({
    mode: 'cloud',
  });

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('OpenAIProvider parses structured JSON finding output', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              findings: [
                {
                  category: 'security',
                  severity: 'critical',
                  confidence: 0.95,
                  startLine: 1,
                  endLine: 2,
                  title: 'Command Injection',
                  explanation: 'User input sent to shell execution',
                  evidence: 'exec(cmd)',
                },
              ],
            }),
          },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const provider = new OpenAIProvider({ apiKey: 'sk-test-mock-key' });
    const isAvail = await provider.isAvailable();
    expect(isAvail).toBe(true);

    const findings = await provider.analyzeDiff(dummyDiff, config, 'security');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('security');
    expect(findings[0]!.severity).toBe('critical');
    expect(findings[0]!.confidence).toBe(0.95);
  });

  it('AnthropicProvider parses Claude messages JSON response', async () => {
    const mockResponse = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            findings: [
              {
                category: 'performance',
                severity: 'major',
                confidence: 0.88,
                startLine: 5,
                endLine: 8,
                title: 'N+1 Query in Loop',
                explanation: 'A database query executes inside a map function',
                evidence: 'items.map(async i => await db.fetch(i.id))',
              },
            ],
          }),
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test-mock-key' });
    const isAvail = await provider.isAvailable();
    expect(isAvail).toBe(true);

    const findings = await provider.analyzeDiff(dummyDiff, config, 'performance');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('performance');
    expect(findings[0]!.severity).toBe('major');
    expect(findings[0]!.confidence).toBe(0.88);
  });

  it('throws helpful error if API key is missing', async () => {
    const provider = new OpenAIProvider({ apiKey: '' });
    await expect(provider.analyzeDiff(dummyDiff, config)).rejects.toThrow('OpenAI API key missing');
  });
});
