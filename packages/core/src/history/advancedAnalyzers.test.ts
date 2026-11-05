import { describe, it, expect, beforeEach } from 'vitest';
import { ApiContractAnalyzer, DatabaseMigrationAnalyzer } from './advancedAnalyzers.js';
import { CodeGraph } from '../indexing/codeGraph.js';
import { FileDiff } from '@cr/shared';

describe('Advanced Analyzers', () => {
  describe('ApiContractAnalyzer', () => {
    let codeGraph: CodeGraph;
    let analyzer: ApiContractAnalyzer;

    beforeEach(() => {
      codeGraph = new CodeGraph();
      // Register known backend routes via FileCodeIntelligence
      codeGraph.addFileIntelligence({
        filePath: 'src/server/routes.ts',
        language: 'typescript',
        symbols: [],
        imports: [],
        calls: [],
        routes: [
          { filePath: 'src/server/routes.ts', method: 'POST', path: '/api/users', handlerSymbol: 'createUser', line: 10 },
          { filePath: 'src/server/routes.ts', method: 'GET', path: '/api/users/:id', handlerSymbol: 'getUserById', line: 25 },
        ],
      });
      analyzer = new ApiContractAnalyzer(codeGraph);
    });

    it('detects unmapped / 404 API calls in client code', () => {
      const clientDiff: FileDiff = {
        oldPath: 'src/dashboard/client.ts',
        newPath: 'src/dashboard/client.ts',
        status: 'modified',
        raw: '+ const res = await fetch("/api/unknown-endpoint");',
        hunks: [
          {
            oldStart: 1,
            oldLines: 0,
            newStart: 15,
            newLines: 1,
            header: '@@ -1,0 +15,1 @@',
            lines: ['+ const res = await fetch("/api/unknown-endpoint");'],
          },
        ],
      };

      const findings = analyzer.analyze(clientDiff);
      expect(findings.length).toBe(1);
      expect(findings[0]!.title).toContain('API Route Not Found');
      expect(findings[0]!.evidence).toContain('/api/unknown-endpoint');
      expect(findings[0]!.category).toBe('architecture');
      expect(findings[0]!.severity).toBe('major');
    });

    it('detects HTTP method mismatches against backend route definitions', () => {
      // Backend defines POST /api/users, client calls DELETE /api/users
      const clientDiff: FileDiff = {
        oldPath: 'src/dashboard/client.ts',
        newPath: 'src/dashboard/client.ts',
        status: 'modified',
        raw: '+ const res = await axios.delete("/api/users");',
        hunks: [
          {
            oldStart: 1,
            oldLines: 0,
            newStart: 30,
            newLines: 1,
            header: '@@ -1,0 +30,1 @@',
            lines: ['+ const res = await axios.delete("/api/users");'],
          },
        ],
      };

      const findings = analyzer.analyze(clientDiff);
      expect(findings.length).toBe(1);
      expect(findings[0]!.title).toContain('API Method Mismatch');
      expect(findings[0]!.severity).toBe('critical');
      expect(findings[0]!.explanation).toContain('runtime');
    });

    it('passes cleanly when frontend call matches backend route and method', () => {
      const clientDiff: FileDiff = {
        oldPath: 'src/client/users.ts',
        newPath: 'src/client/users.ts',
        status: 'modified',
        raw: '+ const res = await axios.post("/api/users", { name: "Alice" });',
        hunks: [
          {
            oldStart: 1,
            oldLines: 0,
            newStart: 5,
            newLines: 1,
            header: '@@ -1,0 +5,1 @@',
            lines: ['+ const res = await axios.post("/api/users", { name: "Alice" });'],
          },
        ],
      };

      const findings = analyzer.analyze(clientDiff);
      expect(findings.length).toBe(0);
    });
  });

  describe('DatabaseMigrationAnalyzer', () => {
    let analyzer: DatabaseMigrationAnalyzer;

    beforeEach(() => {
      analyzer = new DatabaseMigrationAnalyzer();
    });

    it('detects unprotected destructive DROP TABLE operations', () => {
      const diff: FileDiff = {
        oldPath: 'src/db/migrations/004_drop_old.sql',
        newPath: 'src/db/migrations/004_drop_old.sql',
        status: 'added',
        raw: '+ DROP TABLE deprecated_accounts;',
        hunks: [
          {
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: 1,
            header: '@@ -0,0 +1,1 @@',
            lines: ['+ DROP TABLE deprecated_accounts;'],
          },
        ],
      };

      const findings = analyzer.analyze(diff);
      expect(findings.length).toBe(1);
      expect(findings[0]!.title).toContain('Destructive DDL Operation');
      expect(findings[0]!.severity).toBe('critical');
      expect(findings[0]!.explanation).toContain('irreversible data loss');
    });

    it('detects destructive ALTER TABLE DROP COLUMN operations', () => {
      const diff: FileDiff = {
        oldPath: 'db/schema_update.sql',
        newPath: 'db/schema_update.sql',
        status: 'modified',
        raw: '+ ALTER TABLE orders DROP COLUMN legacy_discount;',
        hunks: [
          {
            oldStart: 5,
            oldLines: 0,
            newStart: 5,
            newLines: 1,
            header: '@@ -5,0 +5,1 @@',
            lines: ['+ ALTER TABLE orders DROP COLUMN legacy_discount;'],
          },
        ],
      };

      const findings = analyzer.analyze(diff);
      expect(findings.length).toBe(1);
      expect(findings[0]!.title).toContain('Destructive Column Deletion');
      expect(findings[0]!.severity).toBe('critical');
    });

    it('detects foreign key constraints created without explicit indexes', () => {
      const diff: FileDiff = {
        oldPath: 'src/db/migrations/005_add_fk.sql',
        newPath: 'src/db/migrations/005_add_fk.sql',
        status: 'modified',
        raw: '+ user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,',
        hunks: [
          {
            oldStart: 10,
            oldLines: 0,
            newStart: 10,
            newLines: 1,
            header: '@@ -10,0 +10,1 @@',
            lines: ['+ user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,'],
          },
        ],
      };

      const findings = analyzer.analyze(diff);
      expect(findings.length).toBe(1);
      expect(findings[0]!.title).toContain('Foreign Key Constraint Without Index');
      expect(findings[0]!.severity).toBe('major');
      expect(findings[0]!.explanation).toContain('full table scans');
    });

    it('allows safe migrations and non-database files without false positives', () => {
      const safeDiff: FileDiff = {
        oldPath: 'src/db/migrations/001_initial.sql',
        newPath: 'src/db/migrations/001_initial.sql',
        status: 'added',
        raw: '+ CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT);',
        hunks: [
          {
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: 1,
            header: '@@ -0,0 +1,1 @@',
            lines: ['+ CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, name TEXT);'],
          },
        ],
      };

      const findings = analyzer.analyze(safeDiff);
      expect(findings.length).toBe(0);
    });
  });
});
