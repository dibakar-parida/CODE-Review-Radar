import {
  ReviewFinding,
  PackageBoundaryRule,
  generateFindingId,
} from '@cr/shared';
import { CodeGraph } from '../indexing/codeGraph.js';

export interface ArchitectureDriftOptions {
  codeGraph: CodeGraph;
  boundaryRules?: PackageBoundaryRule[];
  hotspotThreshold?: number;
}

export class ArchitectureDriftAnalyzer {
  private readonly codeGraph: CodeGraph;
  private readonly boundaryRules: PackageBoundaryRule[];
  private readonly hotspotThreshold: number;

  constructor(options: ArchitectureDriftOptions) {
    this.codeGraph = options.codeGraph;
    this.boundaryRules = options.boundaryRules ?? [
      {
        packagePath: 'packages/dashboard',
        disallowedImports: ['@cr/server', '@cr/core'],
        explanation: 'Frontend dashboard must remain decoupled from Node backend runtime and core CLI.',
      },
      {
        packagePath: 'packages/shared',
        disallowedImports: ['@cr/core', '@cr/server', '@cr/cli', '@cr/dashboard', '@cr/vscode-ext'],
        explanation: 'Shared domain package must be a zero-dependency root leaf package.',
      },
    ];
    this.hotspotThreshold = options.hotspotThreshold ?? 15;
  }

  analyze(): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    let count = 1;

    const fileImports = this.codeGraph.getAllImports();

    // 1. Check Package Boundary Violations
    for (const [filePath, imports] of fileImports.entries()) {
      for (const rule of this.boundaryRules) {
        if (filePath.replace(/\\/g, '/').includes(rule.packagePath)) {
          for (const imp of imports) {
            for (const disallowed of rule.disallowedImports) {
              if (imp.sourceModule === disallowed || imp.sourceModule.startsWith(`${disallowed}/`)) {
                findings.push({
                  id: generateFindingId('architecture', count++),
                  category: 'architecture',
                  severity: 'critical',
                  confidence: 1.0,
                  filePath,
                  startLine: imp.line || 1,
                  endLine: imp.line || 1,
                  title: `Package Boundary Violation: Import of ${disallowed}`,
                  explanation: `Architecture violation: "${filePath}" imports forbidden dependency "${disallowed}". Policy: ${rule.explanation}`,
                  evidence: `import ... from '${imp.sourceModule}';`,
                  blastRadius: [`pkg:${disallowed}`],
                  verifiedBy: ['ast'],
                });
              }
            }
          }
        }
      }
    }

    // 2. Check Circular Dependencies (Directed Cycle Detection)
    const cycles = this.findCircularDependencies(fileImports);
    for (const cycle of cycles) {
      const primaryFile = cycle[0]!;
      findings.push({
        id: generateFindingId('architecture', count++),
        category: 'architecture',
        severity: 'major',
        confidence: 0.95,
        filePath: primaryFile,
        startLine: 1,
        endLine: 1,
        title: `Circular Dependency Detected: ${cycle.join(' ➔ ')}`,
        explanation: `A circular dependency cycle was detected involving ${cycle.length} files. Circular imports risk undefined runtime values and prevent effective tree-shaking.`,
        evidence: `Cycle: ${cycle.join(' ➔ ')}`,
        blastRadius: cycle.map((f) => `file:${f}`),
        verifiedBy: ['ast'],
      });
    }

    // 3. Architectural Hotspot Detection (High Fan-Out Coupling)
    for (const [filePath, imports] of fileImports.entries()) {
      if (imports.length >= this.hotspotThreshold) {
        findings.push({
          id: generateFindingId('architecture', count++),
          category: 'architecture',
          severity: 'minor',
          confidence: 0.9,
          filePath,
          startLine: 1,
          endLine: 1,
          title: `Architectural Hotspot: High Coupling (${imports.length} imports)`,
          explanation: `File imports ${imports.length} modules, exceeding the recommended coupling threshold (${this.hotspotThreshold}). Consider modular decomposition.`,
          evidence: `Total module imports: ${imports.length}`,
          blastRadius: [`fan-out:${imports.length}`],
          verifiedBy: ['ast'],
        });
      }
    }

    return findings;
  }

  /**
   * Finds all circular dependency cycles among files in the code graph.
   */
  findCircularDependencies(fileImports: Map<string, Array<{ sourceModule: string }>>): string[][] {
    const adj = new Map<string, Set<string>>();

    // Helper to resolve relative module imports
    for (const [file, imports] of fileImports.entries()) {
      const neighbors = adj.get(file) ?? new Set<string>();
      for (const imp of imports) {
        if (imp.sourceModule.startsWith('.')) {
          // Normalize relative path
          const target = this.resolveRelativeImport(file, imp.sourceModule);
          if (fileImports.has(target)) {
            neighbors.add(target);
          }
        }
      }
      adj.set(file, neighbors);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const pathStack: string[] = [];
    const discoveredCycles: string[][] = [];
    const recordedCycleFingerprints = new Set<string>();

    const dfs = (node: string) => {
      visited.add(node);
      inStack.add(node);
      pathStack.push(node);

      const neighbors = adj.get(node) ?? new Set<string>();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (inStack.has(neighbor)) {
          // Found cycle: slice from neighbor to end of stack
          const startIndex = pathStack.indexOf(neighbor);
          if (startIndex !== -1) {
            const cycle = pathStack.slice(startIndex);
            cycle.push(neighbor); // close cycle

            // Deduplicate rotated versions of the same cycle
            const sortedNodes = [...new Set(cycle)].sort().join('|');
            if (!recordedCycleFingerprints.has(sortedNodes)) {
              recordedCycleFingerprints.add(sortedNodes);
              discoveredCycles.push(cycle);
            }
          }
        }
      }

      pathStack.pop();
      inStack.delete(node);
    };

    for (const node of adj.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return discoveredCycles;
  }

  private resolveRelativeImport(fromFile: string, relativeModule: string): string {
    const fromParts = fromFile.replace(/\\/g, '/').split('/');
    fromParts.pop(); // remove file name

    const modParts = relativeModule.replace(/\\/g, '/').split('/');
    for (const part of modParts) {
      if (part === '.') continue;
      if (part === '..') {
        fromParts.pop();
      } else {
        fromParts.push(part);
      }
    }

    let resolved = fromParts.join('/');
    if (!resolved.endsWith('.ts') && !resolved.endsWith('.js')) {
      resolved += '.ts';
    }
    return resolved;
  }
}
