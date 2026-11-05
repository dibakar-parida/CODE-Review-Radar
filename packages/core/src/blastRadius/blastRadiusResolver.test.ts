import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGraph } from '../indexing/codeGraph.js';
import { BlastRadiusResolver } from './blastRadiusResolver.js';
import { ReviewFinding } from '@cr/shared';

describe('BlastRadiusResolver (Call Graph & Impact Propagation)', () => {
  let graph: CodeGraph;
  let resolver: BlastRadiusResolver;

  beforeEach(() => {
    graph = new CodeGraph();
    resolver = new BlastRadiusResolver(graph);

    // Populate graph with connected modules
    // File 1: Database Layer (leaf)
    graph.addFileIntelligence({
      filePath: 'src/db/query.ts',
      language: 'typescript',
      symbols: [
        {
          name: 'executeDbQuery',
          filePath: 'src/db/query.ts',
          kind: 'function',
          startLine: 1,
          endLine: 15,
        },
      ],
      imports: [],
      calls: [],
      routes: [],
    });

    // File 2: Repository Layer (calls executeDbQuery)
    graph.addFileIntelligence({
      filePath: 'src/repo/userRepo.ts',
      language: 'typescript',
      symbols: [
        {
          name: 'findUserById',
          filePath: 'src/repo/userRepo.ts',
          kind: 'function',
          startLine: 1,
          endLine: 20,
        },
      ],
      imports: [],
      calls: [
        {
          filePath: 'src/repo/userRepo.ts',
          callerSymbol: 'findUserById',
          calleeSymbol: 'executeDbQuery',
          line: 8,
        },
      ],
      routes: [],
    });

    // File 3: Controller Layer (calls findUserById, exposes API Route)
    graph.addFileIntelligence({
      filePath: 'src/api/userController.ts',
      language: 'typescript',
      symbols: [
        {
          name: 'getUserProfile',
          filePath: 'src/api/userController.ts',
          kind: 'function',
          startLine: 1,
          endLine: 25,
        },
      ],
      imports: [],
      calls: [
        {
          filePath: 'src/api/userController.ts',
          callerSymbol: 'getUserProfile',
          calleeSymbol: 'findUserById',
          line: 10,
        },
      ],
      routes: [
        {
          filePath: 'src/api/userController.ts',
          method: 'GET',
          path: '/api/users/:id',
          handlerSymbol: 'getUserProfile',
          line: 30,
        },
      ],
    });

    // File 4: Test Suite
    graph.addFileIntelligence({
      filePath: 'tests/user.test.ts',
      language: 'typescript',
      symbols: [
        {
          name: 'testUserLookup',
          filePath: 'tests/user.test.ts',
          kind: 'function',
          startLine: 1,
          endLine: 20,
        },
      ],
      imports: [],
      calls: [
        {
          filePath: 'tests/user.test.ts',
          callerSymbol: 'testUserLookup',
          calleeSymbol: 'getUserProfile',
          line: 5,
        },
      ],
      routes: [],
    });
  });

  it('resolves direct and transitive callers for modified leaf function', () => {
    const callers = graph.getTransitiveCallers('executeDbQuery', 3);
    expect(callers).toContain('findUserById'); // Direct
    expect(callers).toContain('getUserProfile'); // Transitive depth 2
    expect(callers).toContain('testUserLookup'); // Transitive depth 3
  });

  it('resolves affected API routes impacted by modified database function', () => {
    const callers = ['executeDbQuery', ...graph.getTransitiveCallers('executeDbQuery', 3)];
    const routes = graph.getImpactedRoutes(callers);

    expect(routes).toContain('GET /api/users/:id');
  });

  it('enriches ReviewFinding with callers, routes, and tests', () => {
    const rawFinding: ReviewFinding = {
      id: 'SEC-001',
      category: 'security',
      severity: 'critical',
      confidence: 0.95,
      filePath: 'src/db/query.ts',
      startLine: 5,
      endLine: 8,
      title: 'SQL injection in executeDbQuery',
      explanation: 'Unsanitized raw SQL parameter',
      evidence: 'db.raw(query)',
      verifiedBy: ['llm'],
    };

    const enriched = resolver.resolveFindingBlastRadius(rawFinding);

    expect(enriched.symbolName).toBe('executeDbQuery');
    expect(enriched.blastRadius).toBeDefined();

    const blast = enriched.blastRadius!;
    expect(blast).toContain('caller:findUserById');
    expect(blast).toContain('caller:getUserProfile');
    expect(blast).toContain('route:GET /api/users/:id');
    expect(blast).toContain('test:tests/user.test.ts');
  });
});
