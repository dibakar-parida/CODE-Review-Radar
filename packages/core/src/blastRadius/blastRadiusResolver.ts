import { ReviewFinding } from '@cr/shared';
import { CodeGraph } from '../indexing/codeGraph.js';

export class BlastRadiusResolver {
  private readonly codeGraph: CodeGraph;

  constructor(codeGraph: CodeGraph) {
    this.codeGraph = codeGraph;
  }

  /**
   * Enriches a single ReviewFinding with blast radius callers and impacted routes.
   */
  resolveFindingBlastRadius(finding: ReviewFinding): ReviewFinding {
    // 1. Identify modified symbol if not already set
    let symbolName = finding.symbolName;
    if (!symbolName) {
      const enclosing = this.codeGraph.findEnclosingSymbol(finding.filePath, finding.startLine);
      if (enclosing) {
        symbolName = enclosing.name;
      }
    }

    if (!symbolName) {
      return finding;
    }

    // 2. Discover direct & transitive callers
    const callers = this.codeGraph.getTransitiveCallers(symbolName, 3);

    // 3. Discover affected API routes
    const symbolsToCheck = [symbolName, ...callers];
    const routes = this.codeGraph.getImpactedRoutes(symbolsToCheck);

    // 4. Discover impacted test files
    const allSymbols = this.codeGraph.getAllSymbols();
    const testFiles = new Set<string>();

    for (const s of allSymbols) {
      if (
        (s.filePath.includes('.test.') || s.filePath.includes('.spec.')) &&
        callers.includes(s.name)
      ) {
        testFiles.add(s.filePath);
      }
    }

    // 5. Build consolidated blast radius labels
    const blastRadiusItems: string[] = [];

    for (const caller of callers) {
      blastRadiusItems.push(`caller:${caller}`);
    }

    for (const route of routes) {
      blastRadiusItems.push(`route:${route}`);
    }

    for (const tf of testFiles) {
      blastRadiusItems.push(`test:${tf}`);
    }

    // Merge with any existing blastRadius
    const existing = finding.blastRadius ?? [];
    const merged = Array.from(new Set([...existing, ...blastRadiusItems]));

    return {
      ...finding,
      symbolName,
      blastRadius: merged.length > 0 ? merged : undefined,
    };
  }

  /**
   * Enriches all findings with blast radius analysis.
   */
  enrichFindings(findings: ReviewFinding[]): ReviewFinding[] {
    return findings.map((f) => this.resolveFindingBlastRadius(f));
  }
}
