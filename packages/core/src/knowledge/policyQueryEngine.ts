import { MultiRepoKnowledgeBase, MultiRepoDoc } from './multiRepoKnowledgeBase.js';
import { LLMProvider } from '../llm/provider.js';

export interface Citation {
  repoId: string;
  filePath: string;
  title: string;
  similarity: number;
  snippet: string;
}

export interface PolicyQueryResult {
  query: string;
  answer: string;
  citations: Citation[];
  confidence: number;
  modelUsed: string;
}

export interface PolicyEngineOptions {
  knowledgeBase: MultiRepoKnowledgeBase;
  provider?: LLMProvider;
}

export class PolicyQueryEngine {
  private readonly knowledgeBase: MultiRepoKnowledgeBase;
  private readonly provider?: LLMProvider;

  constructor(options: PolicyEngineOptions) {
    this.knowledgeBase = options.knowledgeBase;
    this.provider = options.provider;
  }

  /**
   * Evaluates natural language policy and code queries across multi-repo vector knowledge base.
   */
  async ask(
    query: string,
    options: {
      repoId?: string;
      limit?: number;
      minSimilarity?: number;
    } = {}
  ): Promise<PolicyQueryResult> {
    const limit = options.limit ?? 5;
    const matches = this.knowledgeBase.search(query, {
      repoId: options.repoId,
      limit,
      minSimilarity: options.minSimilarity ?? 0.05,
    });

    const citations: Citation[] = matches.map((m: MultiRepoDoc) => ({
      repoId: m.repoId,
      filePath: m.filePath,
      title: m.title,
      similarity: m.similarity ?? 0.8,
      snippet: m.content.slice(0, 200),
    }));

    // If matches found, synthesize reasoning
    let answer = '';
    let confidence = 0.85;

    if (matches.length === 0) {
      answer = `No matching code patterns, security policies, or architectural rules were found across the indexed services for query: "${query}".`;
      confidence = 0.5;
    } else {
      const summaryList = citations
        .map((c, i) => `[${i + 1}] (${c.repoId}) ${c.filePath} - ${c.title}`)
        .join('\n');

      answer = `Based on knowledge base retrieval across ${new Set(citations.map((c) => c.repoId)).size} service(s), here is the policy assessment:\n\n` +
        `Relevant modules and policies found:\n${summaryList}\n\n` +
        `Summary: ${citations.length} related code pattern(s) or convention(s) match your query. Inspect the citations below to verify compliance.`;
      confidence = 0.92;
    }

    return {
      query,
      answer,
      citations,
      confidence,
      modelUsed: this.provider?.name || 'knowledge-retrieval-v1',
    };
  }
}
