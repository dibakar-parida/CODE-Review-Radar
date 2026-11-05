import { FileDiff, ReviewFinding, ReviewConfig, ReviewCategory } from '@cr/shared';
import { LLMProvider } from './provider.js';

export interface FallbackProviderOptions {
  primary: LLMProvider;
  fallbacks: LLMProvider[];
  onFallback?: (failedProvider: LLMProvider, error: Error, fallbackProvider: LLMProvider) => void;
}

export class FallbackLLMProvider implements LLMProvider {
  readonly name: string;
  private readonly primary: LLMProvider;
  private readonly fallbacks: LLMProvider[];
  private readonly onFallback?: (failedProvider: LLMProvider, error: Error, fallbackProvider: LLMProvider) => void;
  private lastUsedProviderName: string;

  constructor(options: FallbackProviderOptions) {
    this.primary = options.primary;
    this.fallbacks = options.fallbacks;
    this.onFallback = options.onFallback;
    this.name = `fallback(${this.primary.name} -> ${this.fallbacks.map((f) => f.name).join(', ')})`;
    this.lastUsedProviderName = this.primary.name;
  }

  getLastUsedProviderName(): string {
    return this.lastUsedProviderName;
  }

  async isAvailable(): Promise<boolean> {
    const primaryOk = await this.primary.isAvailable().catch(() => false);
    if (primaryOk) return true;

    for (const fb of this.fallbacks) {
      const fbOk = await fb.isAvailable().catch(() => false);
      if (fbOk) return true;
    }

    return false;
  }

  async analyzeDiff(
    diff: FileDiff,
    config: ReviewConfig,
    category?: ReviewCategory,
    extraContext?: { conventions?: string }
  ): Promise<ReviewFinding[]> {
    const chain = [this.primary, ...this.fallbacks];
    const errors: Array<{ provider: string; error: string }> = [];

    for (let i = 0; i < chain.length; i++) {
      const currentProvider = chain[i]!;
      try {
        const findings = await currentProvider.analyzeDiff(diff, config, category, extraContext);
        this.lastUsedProviderName = currentProvider.name;
        return findings;
      } catch (err: unknown) {
        const error = err as Error;
        errors.push({ provider: currentProvider.name, error: error.message });

        const nextProvider = chain[i + 1];
        if (nextProvider) {
          if (this.onFallback) {
            this.onFallback(currentProvider, error, nextProvider);
          } else {
            console.warn(
              `[FallbackLLMProvider] Provider "${currentProvider.name}" failed: ${error.message}. Failing over to "${nextProvider.name}"...`
            );
          }
        }
      }
    }

    const errorDetails = errors.map((e) => `[${e.provider}]: ${e.error}`).join(' | ');
    throw new Error(`All LLM providers in fallback chain failed: ${errorDetails}`);
  }
}
