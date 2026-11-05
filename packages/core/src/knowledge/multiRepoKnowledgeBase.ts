import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { SQLiteStorage } from '../indexing/sqliteStorage.js';
import { ASTCodeParser, FileCodeIntelligence } from '../indexing/astParser.js';

export interface MultiRepoDoc {
  repoId: string;
  docId: string;
  kind: 'symbol' | 'finding' | 'rule' | 'file';
  title: string;
  content: string;
  filePath: string;
  similarity?: number;
}

export interface MultiRepoOptions {
  storage: SQLiteStorage;
  embeddingDim?: number;
}

export class MultiRepoKnowledgeBase {
  private readonly storage: SQLiteStorage;
  private readonly parser: ASTCodeParser;
  private readonly dim: number;

  constructor(options: MultiRepoOptions) {
    this.storage = options.storage;
    this.parser = new ASTCodeParser();
    this.dim = options.embeddingDim ?? 64;
  }

  /**
   * Registers a distinct repository into the multi-repo knowledge graph.
   */
  registerRepository(repoId: string, name: string, rootPath: string): void {
    this.storage.registerRepository(repoId, name, rootPath);
  }

  getRegisteredRepositories() {
    return this.storage.getAllRepositories();
  }

  /**
   * Generates a deterministic unit-normalized embedding vector for text.
   */
  generateEmbedding(text: string): number[] {
    const vector = new Array<number>(this.dim).fill(0);
    const tokens = text.toLowerCase().replace(/[^a-z0-9_\s]/g, ' ').split(/\s+/).filter(Boolean);

    for (const token of tokens) {
      const hash = crypto.createHash('md5').update(token).digest();
      const bucket = hash.readUInt16BE(0) % this.dim;
      const weight = (hash.readUInt8(2) / 255) * 2 - 1;
      vector[bucket]! += weight;
    }

    // Normalize to unit vector
    let norm = 0;
    for (let i = 0; i < this.dim; i++) {
      norm += vector[i]! * vector[i]!;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dim; i++) {
        vector[i] = Math.round((vector[i]! / norm) * 10000) / 10000;
      }
    }

    return vector;
  }

  /**
   * Indexes a code file or symbol into the knowledge base under the specified repository.
   */
  indexDocument(doc: {
    repoId: string;
    docId: string;
    kind: 'symbol' | 'finding' | 'rule' | 'file';
    title: string;
    content: string;
    filePath: string;
  }): void {
    const textToEmbed = `${doc.title} ${doc.content} ${doc.filePath}`;
    const vector = this.generateEmbedding(textToEmbed);

    this.storage.saveMultiRepoEmbedding({
      repoId: doc.repoId,
      docId: doc.docId,
      kind: doc.kind,
      title: doc.title,
      content: doc.content,
      filePath: doc.filePath,
      vector,
    });
  }

  /**
   * Queries knowledge base across all repositories using semantic vector cosine similarity.
   */
  search(
    queryText: string,
    options: {
      repoId?: string;
      kind?: 'symbol' | 'finding' | 'rule' | 'file';
      limit?: number;
      minSimilarity?: number;
    } = {}
  ): MultiRepoDoc[] {
    const queryVector = this.generateEmbedding(queryText);
    const results = this.storage.searchSimilarEmbeddings(queryVector, {
      repoId: options.repoId,
      kind: options.kind,
      limit: options.limit ?? 5,
      minSimilarity: options.minSimilarity ?? 0.0,
    });

    return results.map((r) => ({
      repoId: r.repoId,
      docId: r.docId,
      kind: r.kind as 'symbol' | 'finding' | 'rule' | 'file',
      title: r.title,
      content: r.content,
      filePath: r.filePath,
      similarity: r.similarity,
    }));
  }
}
