import { describe, it, expect, vi } from 'vitest';
import { FallbackLLMProvider } from '../llm/fallbackProvider.js';
import { LLMProvider } from '../llm/provider.js';
import { FileDiff, ReviewConfigSchema, ReviewFinding } from '@cr/shared';

describe('FallbackLLMProvider', () => {
  const dummyDiff: FileDiff = {
    oldPath: 'src/main.ts',
    newPath: 'src/main.ts',
    status: 'modified',
    raw: '+ const a = 1;',
    hunks: [],
  };

  const dummyConfig = ReviewConfigSchema.parse({});

  const sampleFinding: ReviewFinding = {
    id: 'SEC-001',
    category: 'security',
    severity: 'critical',
    confidence: 0.95,
    filePath: 'src/main.ts',
    startLine: 1,
    endLine: 1,
    title: 'Critical Vulnerability',
    explanation: 'Dangerous pattern detected',
    evidence: 'const a = 1;',
    verifiedBy: ['llm'],
  };

  it('uses primary provider when primary is healthy and responsive', async () => {
    const primary: LLMProvider = {
      name: 'ollama-local',
      isAvailable: async () => true,
      analyzeDiff: async () => [sampleFinding],
    };

    const fallback: LLMProvider = {
      name: 'openai-cloud',
      isAvailable: async () => true,
      analyzeDiff: vi.fn(),
    };

    const provider = new FallbackLLMProvider({
      primary,
      fallbacks: [fallback],
    });

    const findings = await provider.analyzeDiff(dummyDiff, dummyConfig);
    expect(findings).toEqual([sampleFinding]);
    expect(provider.getLastUsedProviderName()).toBe('ollama-local');
    expect(fallback.analyzeDiff).not.toHaveBeenCalled();
  });

  it('automatically falls back to secondary provider when primary fails', async () => {
    const onFallbackSpy = vi.fn();

    const primary: LLMProvider = {
      name: 'ollama-primary',
      isAvailable: async () => true,
      analyzeDiff: async () => {
        throw new Error('Connection refused at 127.0.0.1:11434 (model unloaded)');
      },
    };

    const secondary: LLMProvider = {
      name: 'anthropic-fallback',
      isAvailable: async () => true,
      analyzeDiff: async () => [sampleFinding],
    };

    const provider = new FallbackLLMProvider({
      primary,
      fallbacks: [secondary],
      onFallback: onFallbackSpy,
    });

    const findings = await provider.analyzeDiff(dummyDiff, dummyConfig);
    expect(findings).toEqual([sampleFinding]);
    expect(provider.getLastUsedProviderName()).toBe('anthropic-fallback');
    expect(onFallbackSpy).toHaveBeenCalledTimes(1);
    expect(onFallbackSpy).toHaveBeenCalledWith(
      primary,
      expect.any(Error),
      secondary
    );
  });

  it('throws combined error when all providers in fallback chain fail', async () => {
    const primary: LLMProvider = {
      name: 'ollama-local',
      isAvailable: async () => false,
      analyzeDiff: async () => {
        throw new Error('Ollama process terminated');
      },
    };

    const secondary: LLMProvider = {
      name: 'openai-fallback',
      isAvailable: async () => false,
      analyzeDiff: async () => {
        throw new Error('OpenAI rate limit exceeded (429)');
      },
    };

    const provider = new FallbackLLMProvider({
      primary,
      fallbacks: [secondary],
    });

    await expect(provider.analyzeDiff(dummyDiff, dummyConfig)).rejects.toThrow(
      /All LLM providers in fallback chain failed: \[ollama-local\]: Ollama process terminated \| \[openai-fallback\]: OpenAI rate limit exceeded \(429\)/
    );
  });

  it('verifies availability cascading', async () => {
    const offlinePrimary: LLMProvider = {
      name: 'local-offline',
      isAvailable: async () => false,
      analyzeDiff: async () => [],
    };

    const onlineFallback: LLMProvider = {
      name: 'cloud-online',
      isAvailable: async () => true,
      analyzeDiff: async () => [],
    };

    const provider = new FallbackLLMProvider({
      primary: offlinePrimary,
      fallbacks: [onlineFallback],
    });

    expect(await provider.isAvailable()).toBe(true);
  });
});
