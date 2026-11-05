import { describe, it, expect, beforeEach } from 'vitest';
import { ArchitectureDriftAnalyzer } from './architectureDrift.js';
import { CodeGraph } from '../indexing/codeGraph.js';

describe('ArchitectureDriftAnalyzer', () => {
  let codeGraph: CodeGraph;

  beforeEach(() => {
    codeGraph = new CodeGraph();
  });

  it('detects package boundary violations across isolated packages', () => {
    codeGraph.addFileIntelligence({
      filePath: 'packages/dashboard/src/components/Header.tsx',
      language: 'typescript',
      symbols: [],
      routes: [],
      calls: [],
      imports: [
        {
          filePath: 'packages/dashboard/src/components/Header.tsx',
          sourceModule: '@cr/server',
          importedSymbol: 'LocalReviewServer',
          isDefault: false,
          line: 2,
        },
      ],
    });

    const analyzer = new ArchitectureDriftAnalyzer({ codeGraph });
    const findings = analyzer.analyze();

    expect(findings.length).toBe(1);
    expect(findings[0]!.title).toContain('Package Boundary Violation');
    expect(findings[0]!.severity).toBe('critical');
    expect(findings[0]!.category).toBe('architecture');
    expect(findings[0]!.explanation).toContain('@cr/server');
  });

  it('detects circular dependency cycles between modules', () => {
    // a.ts -> b.ts
    codeGraph.addFileIntelligence({
      filePath: 'src/services/a.ts',
      language: 'typescript',
      symbols: [],
      routes: [],
      calls: [],
      imports: [
        {
          filePath: 'src/services/a.ts',
          sourceModule: './b',
          importedSymbol: 'bFn',
          isDefault: false,
          line: 1,
        },
      ],
    });

    // b.ts -> c.ts
    codeGraph.addFileIntelligence({
      filePath: 'src/services/b.ts',
      language: 'typescript',
      symbols: [],
      routes: [],
      calls: [],
      imports: [
        {
          filePath: 'src/services/b.ts',
          sourceModule: './c',
          importedSymbol: 'cFn',
          isDefault: false,
          line: 1,
        },
      ],
    });

    // c.ts -> a.ts (cycle!)
    codeGraph.addFileIntelligence({
      filePath: 'src/services/c.ts',
      language: 'typescript',
      symbols: [],
      routes: [],
      calls: [],
      imports: [
        {
          filePath: 'src/services/c.ts',
          sourceModule: './a',
          importedSymbol: 'aFn',
          isDefault: false,
          line: 1,
        },
      ],
    });

    const analyzer = new ArchitectureDriftAnalyzer({ codeGraph });
    const findings = analyzer.analyze();

    const circularFinding = findings.find((f) => f.title.includes('Circular Dependency'));
    expect(circularFinding).toBeDefined();
    expect(circularFinding!.severity).toBe('major');
    expect(circularFinding!.explanation).toContain('circular dependency cycle');
  });

  it('detects architectural hotspots with high coupling / fan-out', () => {
    const heavyImports = Array.from({ length: 16 }, (_, i) => ({
      filePath: 'src/godObject.ts',
      sourceModule: `lib-${i}`,
      importedSymbol: `item${i}`,
      isDefault: false,
      line: i + 1,
    }));

    codeGraph.addFileIntelligence({
      filePath: 'src/godObject.ts',
      language: 'typescript',
      symbols: [],
      routes: [],
      calls: [],
      imports: heavyImports,
    });

    const analyzer = new ArchitectureDriftAnalyzer({
      codeGraph,
      hotspotThreshold: 10,
    });
    const findings = analyzer.analyze();

    const hotspot = findings.find((f) => f.title.includes('Architectural Hotspot'));
    expect(hotspot).toBeDefined();
    expect(hotspot!.explanation).toContain('exceeding the recommended coupling threshold');
  });
});
