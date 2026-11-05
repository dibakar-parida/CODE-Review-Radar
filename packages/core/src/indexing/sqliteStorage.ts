import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { FileCodeIntelligence, CodeSymbol, ImportLink, CallLink, RouteEndpoint } from './astParser.js';

const require = createRequire(import.meta.url);
// Dynamic require for node:sqlite to bypass bundler static resolution issues in test runners
const sqlite = require('node:sqlite') as {
  DatabaseSync: new (dbPath: string) => any;
};
const DatabaseSync = sqlite.DatabaseSync;

export interface SQLiteStorageOptions {
  repoRoot?: string;
  dbPath?: string; // override for tests e.g. ':memory:'
}

export interface SQLitePreparedStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

export interface SQLiteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SQLitePreparedStatement;
  close(): void;
}

export class SQLiteStorage {
  private readonly db: SQLiteDatabase;
  private readonly repoRoot: string;
  private readonly resolvedDbPath: string;

  constructor(options: SQLiteStorageOptions = {}) {
    this.repoRoot = options.repoRoot ?? process.cwd();

    if (options.dbPath) {
      this.resolvedDbPath = options.dbPath;
    } else {
      const crDir = path.join(this.repoRoot, '.cr');
      if (!fs.existsSync(crDir)) {
        fs.mkdirSync(crDir, { recursive: true });
      }
      this.ensureGitignored(crDir);
      this.resolvedDbPath = path.join(crDir, 'index.db');
    }

    this.db = new DatabaseSync(this.resolvedDbPath);
    this.initSchema();
  }

  private ensureGitignored(crDir: string): void {
    const gitignorePath = path.join(this.repoRoot, '.gitignore');
    try {
      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, 'utf-8');
        if (!content.includes('.cr')) {
          fs.appendFileSync(gitignorePath, '\n.cr/\n');
        }
      } else {
        fs.writeFileSync(gitignorePath, '.cr/\nnode_modules/\n');
      }
    } catch {
      // Ignore gitignore write error if directory is read-only
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        file_path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        indexed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        enclosing_symbol TEXT,
        signature TEXT
      );

      CREATE TABLE IF NOT EXISTS imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        source_module TEXT NOT NULL,
        imported_symbol TEXT NOT NULL,
        is_default INTEGER NOT NULL,
        line INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        caller_symbol TEXT NOT NULL,
        callee_symbol TEXT NOT NULL,
        line INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        handler_symbol TEXT NOT NULL,
        line INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        vector_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS review_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern_hash TEXT NOT NULL,
        rule_category TEXT NOT NULL,
        title TEXT NOT NULL,
        file_path TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS multi_repo_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        file_path TEXT NOT NULL,
        vector_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_mrepo_repo ON multi_repo_embeddings(repo_id);
      CREATE INDEX IF NOT EXISTS idx_mrepo_kind ON multi_repo_embeddings(kind);
      CREATE INDEX IF NOT EXISTS idx_decisions_hash ON review_decisions(pattern_hash);
      CREATE INDEX IF NOT EXISTS idx_decisions_decision ON review_decisions(decision);
      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee_symbol);
      CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_symbol);
    `);
  }

  saveFileIntelligence(intel: FileCodeIntelligence, fileHash: string, mtime: number): void {
    // Delete existing file records
    this.removeFile(intel.filePath);

    // Insert file metadata
    const insertFile = this.db.prepare(
      `INSERT INTO files (file_path, hash, mtime, indexed_at) VALUES (?, ?, ?, ?)`
    );
    insertFile.run(intel.filePath, fileHash, mtime, new Date().toISOString());

    // Insert symbols
    const insertSymbol = this.db.prepare(
      `INSERT INTO symbols (file_path, name, kind, start_line, end_line, enclosing_symbol, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const sym of intel.symbols) {
      insertSymbol.run(
        sym.filePath,
        sym.name,
        sym.kind,
        sym.startLine,
        sym.endLine,
        sym.enclosingSymbol || null,
        sym.signature || null
      );
    }

    // Insert imports
    const insertImport = this.db.prepare(
      `INSERT INTO imports (file_path, source_module, imported_symbol, is_default, line)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const imp of intel.imports) {
      insertImport.run(imp.filePath, imp.sourceModule, imp.importedSymbol, imp.isDefault ? 1 : 0, imp.line);
    }

    // Insert calls
    const insertCall = this.db.prepare(
      `INSERT INTO calls (file_path, caller_symbol, callee_symbol, line)
       VALUES (?, ?, ?, ?)`
    );
    for (const call of intel.calls) {
      insertCall.run(call.filePath, call.callerSymbol, call.calleeSymbol, call.line);
    }

    // Insert routes
    const insertRoute = this.db.prepare(
      `INSERT INTO routes (file_path, method, path, handler_symbol, line)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const r of intel.routes) {
      insertRoute.run(r.filePath, r.method, r.path, r.handlerSymbol, r.line);
    }
  }

  removeFile(filePath: string): void {
    this.db.prepare(`DELETE FROM files WHERE file_path = ?`).run(filePath);
    this.db.prepare(`DELETE FROM symbols WHERE file_path = ?`).run(filePath);
    this.db.prepare(`DELETE FROM imports WHERE file_path = ?`).run(filePath);
    this.db.prepare(`DELETE FROM calls WHERE file_path = ?`).run(filePath);
    this.db.prepare(`DELETE FROM routes WHERE file_path = ?`).run(filePath);
  }

  getFileRecord(filePath: string): { hash: string; mtime: number } | null {
    const row = this.db.prepare(`SELECT hash, mtime FROM files WHERE file_path = ?`).get(filePath) as
      | { hash: string; mtime: number }
      | undefined;
    return row ?? null;
  }

  getAllFileRecords(): Map<string, { hash: string; mtime: number }> {
    const rows = this.db.prepare(`SELECT file_path, hash, mtime FROM files`).all() as Array<{
      file_path: string;
      hash: string;
      mtime: number;
    }>;

    const map = new Map<string, { hash: string; mtime: number }>();
    for (const r of rows) {
      map.set(r.file_path, { hash: r.hash, mtime: r.mtime });
    }
    return map;
  }

  loadAllIntelligence(): FileCodeIntelligence[] {
    const files = this.db.prepare(`SELECT file_path FROM files`).all() as Array<{ file_path: string }>;
    const result: FileCodeIntelligence[] = [];

    const getSymbols = this.db.prepare(`SELECT * FROM symbols WHERE file_path = ?`);
    const getImports = this.db.prepare(`SELECT * FROM imports WHERE file_path = ?`);
    const getCalls = this.db.prepare(`SELECT * FROM calls WHERE file_path = ?`);
    const getRoutes = this.db.prepare(`SELECT * FROM routes WHERE file_path = ?`);

    for (const f of files) {
      const symRows = getSymbols.all(f.file_path) as Array<{
        name: string;
        file_path: string;
        kind: string;
        start_line: number;
        end_line: number;
        enclosing_symbol: string | null;
        signature: string | null;
      }>;

      const impRows = getImports.all(f.file_path) as Array<{
        file_path: string;
        source_module: string;
        imported_symbol: string;
        is_default: number;
        line: number;
      }>;

      const callRows = getCalls.all(f.file_path) as Array<{
        file_path: string;
        caller_symbol: string;
        callee_symbol: string;
        line: number;
      }>;

      const routeRows = getRoutes.all(f.file_path) as Array<{
        file_path: string;
        method: string;
        path: string;
        handler_symbol: string;
        line: number;
      }>;

      result.push({
        filePath: f.file_path,
        language: 'typescript', // default descriptor
        symbols: symRows.map((s) => ({
          name: s.name,
          filePath: s.file_path,
          kind: s.kind as any,
          startLine: s.start_line,
          endLine: s.end_line,
          enclosingSymbol: s.enclosing_symbol || undefined,
          signature: s.signature || undefined,
        })),
        imports: impRows.map((i) => ({
          filePath: i.file_path,
          sourceModule: i.source_module,
          importedSymbol: i.imported_symbol,
          isDefault: i.is_default === 1,
          line: i.line,
        })),
        calls: callRows.map((c) => ({
          filePath: c.file_path,
          callerSymbol: c.caller_symbol,
          calleeSymbol: c.callee_symbol,
          line: c.line,
        })),
        routes: routeRows.map((r) => ({
          filePath: r.file_path,
          method: r.method as any,
          path: r.path,
          handlerSymbol: r.handler_symbol,
          line: r.line,
        })),
      });
    }

    return result;
  }

  saveEmbedding(symbolName: string, filePath: string, vector: number[]): void {
    const insert = this.db.prepare(
      `INSERT INTO embeddings (symbol_name, file_path, vector_json, created_at)
       VALUES (?, ?, ?, ?)`
    );
    insert.run(symbolName, filePath, JSON.stringify(vector), new Date().toISOString());
  }

  getEmbeddings(): Array<{ symbolName: string; filePath: string; vector: number[] }> {
    const rows = this.db.prepare(`SELECT symbol_name, file_path, vector_json FROM embeddings`).all() as Array<{
      symbol_name: string;
      file_path: string;
      vector_json: string;
    }>;

    return rows.map((r) => ({
      symbolName: r.symbol_name,
      filePath: r.file_path,
      vector: JSON.parse(r.vector_json),
    }));
  }

  recordDecision(
    patternHash: string,
    ruleCategory: string,
    title: string,
    filePath: string,
    decision: 'accepted' | 'ignored',
    reason?: string
  ): void {
    const insert = this.db.prepare(
      `INSERT INTO review_decisions (pattern_hash, rule_category, title, file_path, decision, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run(patternHash, ruleCategory, title, filePath, decision, reason || null, new Date().toISOString());
  }

  getIgnoredHashes(): Set<string> {
    const rows = this.db.prepare(
      `SELECT DISTINCT pattern_hash FROM review_decisions WHERE decision = 'ignored'`
    ).all() as Array<{ pattern_hash: string }>;

    return new Set(rows.map((r) => r.pattern_hash));
  }

  getLearnedConventions(): Array<{ title: string; category: string; count: number }> {
    const rows = this.db.prepare(
      `SELECT title, rule_category, count(*) as count 
       FROM review_decisions 
       WHERE decision = 'accepted'
       GROUP BY title, rule_category
       ORDER BY count DESC
       LIMIT 20`
    ).all() as Array<{ title: string; rule_category: string; count: number }>;

    return rows.map((r) => ({
      title: r.title,
      category: r.rule_category,
      count: r.count,
    }));
  }

  getTelemetryStats(): Record<string, { accepted: number; ignored: number; total: number; acceptanceRate: number }> {
    const rows = this.db.prepare(
      `SELECT rule_category, decision, count(*) as count 
       FROM review_decisions 
       GROUP BY rule_category, decision`
    ).all() as Array<{ rule_category: string; decision: string; count: number }>;

    const result: Record<string, { accepted: number; ignored: number; total: number; acceptanceRate: number }> = {};
    for (const row of rows) {
      if (!result[row.rule_category]) {
        result[row.rule_category] = { accepted: 0, ignored: 0, total: 0, acceptanceRate: 0 };
      }
      if (row.decision === 'accepted') {
        result[row.rule_category]!.accepted += row.count;
      } else if (row.decision === 'ignored') {
        result[row.rule_category]!.ignored += row.count;
      }
      result[row.rule_category]!.total += row.count;
    }

    for (const cat of Object.keys(result)) {
      const item = result[cat]!;
      item.acceptanceRate = item.total > 0 ? Math.round((item.accepted / item.total) * 100) / 100 : 0;
    }

    return result;
  }

  registerRepository(id: string, name: string, rootPath: string): void {
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO repositories (id, name, root_path, indexed_at)
       VALUES (?, ?, ?, ?)`
    );
    insert.run(id, name, rootPath, new Date().toISOString());
  }

  getAllRepositories(): Array<{ id: string; name: string; rootPath: string; indexedAt: string }> {
    const rows = this.db.prepare(`SELECT id, name, root_path, indexed_at FROM repositories`).all() as Array<{
      id: string;
      name: string;
      root_path: string;
      indexed_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      rootPath: r.root_path,
      indexedAt: r.indexed_at,
    }));
  }

  saveMultiRepoEmbedding(entry: {
    repoId: string;
    docId: string;
    kind: string;
    title: string;
    content: string;
    filePath: string;
    vector: number[];
  }): void {
    const insert = this.db.prepare(
      `INSERT INTO multi_repo_embeddings (repo_id, doc_id, kind, title, content, file_path, vector_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run(
      entry.repoId,
      entry.docId,
      entry.kind,
      entry.title,
      entry.content,
      entry.filePath,
      JSON.stringify(entry.vector),
      new Date().toISOString()
    );
  }

  searchSimilarEmbeddings(
    queryVector: number[],
    options: {
      repoId?: string;
      kind?: string;
      limit?: number;
      minSimilarity?: number;
    } = {}
  ): Array<{
    repoId: string;
    docId: string;
    kind: string;
    title: string;
    content: string;
    filePath: string;
    similarity: number;
  }> {
    const limit = options.limit ?? 5;
    const minSim = options.minSimilarity ?? 0.0;

    let query = `SELECT repo_id, doc_id, kind, title, content, file_path, vector_json FROM multi_repo_embeddings WHERE 1=1`;
    const params: any[] = [];
    if (options.repoId) {
      query += ` AND repo_id = ?`;
      params.push(options.repoId);
    }
    if (options.kind) {
      query += ` AND kind = ?`;
      params.push(options.kind);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      repo_id: string;
      doc_id: string;
      kind: string;
      title: string;
      content: string;
      file_path: string;
      vector_json: string;
    }>;

    const scored = rows.map((row) => {
      const vec = JSON.parse(row.vector_json) as number[];
      const sim = this.computeCosineSimilarity(queryVector, vec);
      return {
        repoId: row.repo_id,
        docId: row.doc_id,
        kind: row.kind,
        title: row.title,
        content: row.content,
        filePath: row.file_path,
        similarity: Math.round(sim * 1000) / 1000,
      };
    });

    return scored
      .filter((s) => s.similarity >= minSim)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  computeCosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Ignore if already closed
    }
  }
}
