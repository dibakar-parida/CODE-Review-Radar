import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { ASTCodeParser } from './astParser.js';
import { CodeGraph } from './codeGraph.js';
import { SQLiteStorage } from './sqliteStorage.js';
import { normalizeToPosix } from '../git/diffParser.js';

export interface IndexerOptions {
  repoRoot?: string;
  storage?: SQLiteStorage;
  codeGraph?: CodeGraph;
  ignorePatterns?: string[];
}

export interface IndexingStats {
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  deletedFiles: number;
  durationMs: number;
}

export const SUPPORTED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.java',
]);

export class RepositoryIndexer {
  private readonly repoRoot: string;
  private readonly parser: ASTCodeParser;
  private readonly storage: SQLiteStorage;
  private readonly codeGraph: CodeGraph;
  private readonly ignorePatterns: string[];

  constructor(options: IndexerOptions = {}) {
    this.repoRoot = options.repoRoot ?? process.cwd();
    this.parser = new ASTCodeParser();
    this.storage = options.storage ?? new SQLiteStorage({ repoRoot: this.repoRoot });
    this.codeGraph = options.codeGraph ?? new CodeGraph();
    this.ignorePatterns = options.ignorePatterns ?? [
      'node_modules',
      'dist',
      '.git',
      '.cr',
      'coverage',
      '.turbo',
      'build',
    ];
  }

  getCodeGraph(): CodeGraph {
    return this.codeGraph;
  }

  getStorage(): SQLiteStorage {
    return this.storage;
  }

  /**
   * Performs full or incremental indexing of the repository.
   */
  async indexRepository(): Promise<IndexingStats> {
    const startTime = Date.now();
    const diskFiles = await this.discoverFiles(this.repoRoot);
    const existingRecords = this.storage.getAllFileRecords();

    let indexedCount = 0;
    let skippedCount = 0;
    let deletedCount = 0;

    const diskSet = new Set<string>();

    for (const absPath of diskFiles) {
      const relPath = normalizeToPosix(path.relative(this.repoRoot, absPath));
      diskSet.add(relPath);

      const stat = await fs.stat(absPath);
      const mtime = stat.mtimeMs;
      const content = await fs.readFile(absPath, 'utf-8');
      const hash = this.computeHash(content);

      const existing = existingRecords.get(relPath);
      if (existing && existing.hash === hash) {
        skippedCount++;
        continue;
      }

      // File is new or modified: parse AST
      const intel = this.parser.parseSource(relPath, content);
      this.storage.saveFileIntelligence(intel, hash, mtime);
      this.codeGraph.addFileIntelligence(intel);
      indexedCount++;
    }

    // Clean up deleted files from SQLite and CodeGraph
    for (const existingPath of existingRecords.keys()) {
      if (!diskSet.has(existingPath)) {
        this.storage.removeFile(existingPath);
        this.codeGraph.removeFile(existingPath);
        deletedCount++;
      }
    }

    // Load any previously indexed files into CodeGraph if not yet loaded
    if (this.codeGraph.getAllSymbols().length === 0) {
      const allIntel = this.storage.loadAllIntelligence();
      for (const intel of allIntel) {
        this.codeGraph.addFileIntelligence(intel);
      }
    }

    return {
      totalFiles: diskFiles.length,
      indexedFiles: indexedCount,
      skippedFiles: skippedCount,
      deletedFiles: deletedCount,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Re-indexes a specific set of modified/added files (e.g. from Git diff).
   */
  async reindexFiles(filePaths: string[]): Promise<number> {
    let count = 0;

    for (const rel of filePaths) {
      const posix = normalizeToPosix(rel);
      const absPath = path.resolve(this.repoRoot, posix);

      try {
        const stat = await fs.stat(absPath);
        const content = await fs.readFile(absPath, 'utf-8');
        const hash = this.computeHash(content);

        const intel = this.parser.parseSource(posix, content);
        this.storage.saveFileIntelligence(intel, hash, stat.mtimeMs);
        this.codeGraph.addFileIntelligence(intel);
        count++;
      } catch {
        // File may have been deleted
        this.storage.removeFile(posix);
        this.codeGraph.removeFile(posix);
      }
    }

    return count;
  }

  private async discoverFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const name = entry.name;
      if (this.ignorePatterns.some((p) => name === p || name.startsWith('.'))) {
        continue;
      }

      const fullPath = path.join(dir, name);
      if (entry.isDirectory()) {
        const subFiles = await this.discoverFiles(fullPath);
        results.push(...subFiles);
      } else if (entry.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }

    return results;
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
