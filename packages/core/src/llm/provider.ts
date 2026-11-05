import { FileDiff, ReviewFinding, ReviewConfig, ReviewCategory, generateFindingId } from '@cr/shared';
import { buildReviewPromptV1 } from '../prompts/reviewPrompt.js';
import { getAgentPromptForCategory } from '../prompts/agentRegistry.js';

export interface RawAIFinding {
  category: 'bug' | 'security' | 'performance' | 'architecture' | 'quality' | 'testing';
  severity: 'critical' | 'major' | 'minor' | 'info';
  confidence: number;
  startLine: number;
  endLine: number;
  symbolName?: string;
  title: string;
  explanation: string;
  evidence: string;
  blastRadius?: string[];
  suggestedPatch?: string;
  suggestedTest?: string;
}

export interface LLMProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  analyzeDiff(
    diff: FileDiff,
    config: ReviewConfig,
    category?: ReviewCategory,
    extraContext?: { conventions?: string }
  ): Promise<ReviewFinding[]>;
}

function parseFindingsHelper(rawText: string, filePath: string, minConfidence: number): ReviewFinding[] {
  let clean = rawText.trim();
  if (clean.startsWith('```json')) {
    clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (clean.startsWith('```')) {
    clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  let parsed: { findings?: RawAIFinding[] } = {};
  try {
    parsed = JSON.parse(clean);
  } catch {
    return [];
  }

  const list = Array.isArray(parsed.findings) ? parsed.findings : [];
  const valid: ReviewFinding[] = [];

  let count = 1;
  for (const item of list) {
    if (
      item &&
      typeof item.startLine === 'number' &&
      typeof item.endLine === 'number' &&
      typeof item.title === 'string' &&
      typeof item.explanation === 'string'
    ) {
      const conf = typeof item.confidence === 'number' ? item.confidence : 0.8;
      if (conf < minConfidence) continue;

      const category = item.category || 'quality';
      const severity = item.severity || 'minor';

      valid.push({
        id: generateFindingId(category, count++),
        category,
        severity,
        confidence: Math.min(Math.max(conf, 0), 1),
        filePath,
        startLine: Math.max(1, Math.floor(item.startLine)),
        endLine: Math.max(1, Math.floor(item.endLine)),
        symbolName: item.symbolName,
        title: item.title,
        explanation: item.explanation,
        evidence: item.evidence || '',
        blastRadius: Array.isArray(item.blastRadius) ? item.blastRadius : undefined,
        suggestedPatch: item.suggestedPatch,
        suggestedTest: item.suggestedTest,
        verifiedBy: ['llm'],
      });
    }
  }

  return valid;
}

/**
 * Ollama Local-First Adapter (zero network egress).
 */
export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config?: { endpoint?: string; model?: string; timeoutMs?: number }) {
    this.endpoint = config?.endpoint ?? 'http://127.0.0.1:11434';
    this.model = config?.model ?? 'qwen2.5-coder:7b';
    this.timeoutMs = config?.timeoutMs ?? 60000;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.endpoint}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  async analyzeDiff(
    diff: FileDiff,
    config: ReviewConfig,
    category?: ReviewCategory,
    extraContext?: { conventions?: string }
  ): Promise<ReviewFinding[]> {
    const filePath = diff.newPath || diff.oldPath || 'unknown';
    const { system, user } = category
      ? getAgentPromptForCategory(category, {
          diff,
          minConfidence: config.review.minConfidence,
          conventions: extraContext?.conventions,
        })
      : buildReviewPromptV1({
          diff,
          categories: config.review.categories,
          minConfidence: config.review.minConfidence,
        });

    const payload = {
      model: this.model,
      system,
      prompt: user,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1,
        num_ctx: config.local.contextWindowTokens,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let responseText = '';
    try {
      const res = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as { response?: string };
      responseText = data.response ?? '';
    } catch (err: unknown) {
      const e = err as Error;
      throw new Error(`Failed to query Ollama at ${this.endpoint}: ${e.message}`);
    } finally {
      clearTimeout(timeout);
    }

    return parseFindingsHelper(responseText, filePath, config.review.minConfidence);
  }
}

/**
 * OpenAI Cloud Provider Adapter.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(config?: { apiKey?: string; model?: string; endpoint?: string; timeoutMs?: number }) {
    this.apiKey = config?.apiKey || process.env['OPENAI_API_KEY'] || '';
    this.model = config?.model || 'gpt-4o';
    this.endpoint = (config?.endpoint || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.timeoutMs = config?.timeoutMs ?? 60000;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async analyzeDiff(
    diff: FileDiff,
    config: ReviewConfig,
    category?: ReviewCategory,
    extraContext?: { conventions?: string }
  ): Promise<ReviewFinding[]> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key missing. Set OPENAI_API_KEY environment variable or configure in .cr.yaml.');
    }

    const filePath = diff.newPath || diff.oldPath || 'unknown';
    const { system, user } = category
      ? getAgentPromptForCategory(category, {
          diff,
          minConfidence: config.review.minConfidence,
          conventions: extraContext?.conventions,
        })
      : buildReviewPromptV1({
          diff,
          categories: config.review.categories,
          minConfidence: config.review.minConfidence,
        });

    const payload = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let responseText = '';
    try {
      const res = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        throw new Error(`OpenAI API error [${res.status}]: ${errorBody || res.statusText}`);
      }

      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      responseText = data.choices?.[0]?.message?.content ?? '';
    } catch (err: unknown) {
      throw new Error(`Failed to query OpenAI at ${this.endpoint}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }

    return parseFindingsHelper(responseText, filePath, config.review.minConfidence);
  }
}

/**
 * Anthropic Claude Cloud Provider Adapter.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(config?: { apiKey?: string; model?: string; endpoint?: string; timeoutMs?: number }) {
    this.apiKey = config?.apiKey || process.env['ANTHROPIC_API_KEY'] || '';
    this.model = config?.model || 'claude-3-5-sonnet-20241022';
    this.endpoint = (config?.endpoint || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    this.timeoutMs = config?.timeoutMs ?? 60000;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async analyzeDiff(
    diff: FileDiff,
    config: ReviewConfig,
    category?: ReviewCategory,
    extraContext?: { conventions?: string }
  ): Promise<ReviewFinding[]> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key missing. Set ANTHROPIC_API_KEY environment variable or configure in .cr.yaml.');
    }

    const filePath = diff.newPath || diff.oldPath || 'unknown';
    const { system, user } = category
      ? getAgentPromptForCategory(category, {
          diff,
          minConfidence: config.review.minConfidence,
          conventions: extraContext?.conventions,
        })
      : buildReviewPromptV1({
          diff,
          categories: config.review.categories,
          minConfidence: config.review.minConfidence,
        });

    const payload = {
      model: this.model,
      system,
      messages: [{ role: 'user', content: user }],
      max_tokens: 4096,
      temperature: 0.1,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let responseText = '';
    try {
      const res = await fetch(`${this.endpoint}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        throw new Error(`Anthropic API error [${res.status}]: ${errorBody || res.statusText}`);
      }

      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const textBlock = data.content?.find((b) => b.type === 'text');
      responseText = textBlock?.text ?? '';
    } catch (err: unknown) {
      throw new Error(`Failed to query Anthropic at ${this.endpoint}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }

    return parseFindingsHelper(responseText, filePath, config.review.minConfidence);
  }
}

/**
 * Deterministic Mock LLM Provider for unit testing and offline review.
 */
export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock';
  private readonly findingsToReturn: RawAIFinding[];

  constructor(findingsToReturn: RawAIFinding[] = []) {
    this.findingsToReturn = findingsToReturn;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async analyzeDiff(
    diff: FileDiff,
    config: ReviewConfig,
    category?: ReviewCategory,
    _extraContext?: { conventions?: string }
  ): Promise<ReviewFinding[]> {
    const filePath = diff.newPath || diff.oldPath || 'unknown';
    let count = 1;

    return this.findingsToReturn
      .filter((f) => {
        if (f.confidence < config.review.minConfidence) return false;
        if (category && f.category !== category) return false;
        return true;
      })
      .map((f) => ({
        id: generateFindingId(f.category, count++),
        category: f.category,
        severity: f.severity,
        confidence: f.confidence,
        filePath,
        startLine: f.startLine,
        endLine: f.endLine,
        symbolName: f.symbolName,
        title: f.title,
        explanation: f.explanation,
        evidence: f.evidence,
        blastRadius: f.blastRadius,
        suggestedPatch: f.suggestedPatch,
        suggestedTest: f.suggestedTest,
        verifiedBy: ['llm'],
      }));
  }
}

/**
 * Google Gemini Cloud Provider Adapter (Gemini 1.5 Pro / Flash).
 */
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(config?: { apiKey?: string; model?: string; endpoint?: string; timeoutMs?: number }) {
    this.apiKey = config?.apiKey || process.env['GEMINI_API_KEY'] || '';
    this.model = config?.model || process.env['GEMINI_MODEL'] || 'gemini-flash-latest';
    this.endpoint = (config?.endpoint || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    this.timeoutMs = config?.timeoutMs ?? 60000;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async analyzeDiff(
    diff: FileDiff,
    config: ReviewConfig,
    category?: ReviewCategory,
    extraContext?: { conventions?: string }
  ): Promise<ReviewFinding[]> {
    if (!this.apiKey) {
      throw new Error('Google Gemini API key missing. Set GEMINI_API_KEY environment variable or configure in .cr.yaml.');
    }

    const filePath = diff.newPath || diff.oldPath || 'unknown';
    const { system, user } = category
      ? getAgentPromptForCategory(category, {
          diff,
          minConfidence: config.review.minConfidence,
          conventions: extraContext?.conventions,
        })
      : buildReviewPromptV1({
          diff,
          categories: config.review.categories,
          minConfidence: config.review.minConfidence,
        });

    const combinedPrompt = `${system}\n\n${user}`;
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: combinedPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let responseText = '';
    try {
      const url = `${this.endpoint}/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        throw new Error(`Gemini API error [${res.status}]: ${errorBody || res.statusText}`);
      }

      const data = (await res.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };
      responseText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    } catch (err: unknown) {
      throw new Error(`Failed to query Google Gemini at ${this.endpoint}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }

    return parseFindingsHelper(responseText, filePath, config.review.minConfidence);
  }
}

/**
 * Generic OpenAI-Compatible Cloud/Local Adapter (Groq, Mistral, DeepSeek, OpenRouter, vLLM, LocalAI).
 */
export class CustomOpenAIProvider implements LLMProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(config?: {
    name?: string;
    apiKey?: string;
    model?: string;
    endpoint?: string;
    timeoutMs?: number;
  }) {
    this.name = config?.name || 'custom';
    this.apiKey = config?.apiKey || process.env['CUSTOM_LLM_API_KEY'] || '';
    this.model = config?.model || 'deepseek-coder';
    this.endpoint = (config?.endpoint || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
    this.timeoutMs = config?.timeoutMs ?? 60000;
  }

  async isAvailable(): Promise<boolean> {
    if (this.endpoint.includes('127.0.0.1') || this.endpoint.includes('localhost')) {
      return true;
    }
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async analyzeDiff(
    diff: FileDiff,
    config: ReviewConfig,
    category?: ReviewCategory,
    extraContext?: { conventions?: string }
  ): Promise<ReviewFinding[]> {
    const filePath = diff.newPath || diff.oldPath || 'unknown';
    const { system, user } = category
      ? getAgentPromptForCategory(category, {
          diff,
          minConfidence: config.review.minConfidence,
          conventions: extraContext?.conventions,
        })
      : buildReviewPromptV1({
          diff,
          categories: config.review.categories,
          minConfidence: config.review.minConfidence,
        });

    const payload = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let responseText = '';
    try {
      const res = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        throw new Error(`${this.name} API error [${res.status}]: ${errorBody || res.statusText}`);
      }

      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      responseText = data.choices?.[0]?.message?.content ?? '';
    } catch (err: unknown) {
      throw new Error(`Failed to query ${this.name} at ${this.endpoint}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }

    return parseFindingsHelper(responseText, filePath, config.review.minConfidence);
  }
}

/**
 * Universal LLM Provider Factory.
 */
export function createLLMProvider(
  type: 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'custom' | 'mock',
  options?: {
    apiKey?: string;
    model?: string;
    endpoint?: string;
    timeoutMs?: number;
    name?: string;
    mockFindings?: RawAIFinding[];
  }
): LLMProvider {
  switch (type) {
    case 'ollama':
      return new OllamaProvider(options);
    case 'openai':
      return new OpenAIProvider(options);
    case 'anthropic':
      return new AnthropicProvider(options);
    case 'gemini':
      return new GeminiProvider(options);
    case 'custom':
      return new CustomOpenAIProvider(options);
    case 'mock':
      return new MockLLMProvider(options?.mockFindings ?? []);
    default:
      throw new Error(`Unsupported LLM provider type: ${type}`);
  }
}
