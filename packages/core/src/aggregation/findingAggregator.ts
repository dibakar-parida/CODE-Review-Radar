import {
  ReviewFinding,
  ReviewSeverity,
  VerificationMethod,
  compareSeverity,
  generateFindingId,
} from '@cr/shared';

export interface AggregatorOptions {
  lineTolerance?: number; // Line distance threshold to consider findings overlapping
  maxFindingsPerFile?: number;
}

export class FindingAggregator {
  private readonly lineTolerance: number;
  private readonly maxFindingsPerFile: number;

  constructor(options: AggregatorOptions = {}) {
    this.lineTolerance = options.lineTolerance ?? 2;
    this.maxFindingsPerFile = options.maxFindingsPerFile ?? 20;
  }

  /**
   * Merges, deduplicates, and scores overlapping findings from AI agents and static tools.
   */
  aggregate(findings: ReviewFinding[]): ReviewFinding[] {
    if (findings.length === 0) return [];

    // Group findings by filePath
    const byFile = new Map<string, ReviewFinding[]>();
    for (const f of findings) {
      const list = byFile.get(f.filePath) ?? [];
      list.push(f);
      byFile.set(f.filePath, list);
    }

    const mergedAll: ReviewFinding[] = [];

    // Merge within each file
    for (const [filePath, fileFindings] of byFile.entries()) {
      const mergedFileFindings = this.mergeFileFindings(fileFindings);
      mergedAll.push(...mergedFileFindings);
    }

    // Sort deterministically:
    // 1. Severity rank (critical > major > minor > info)
    // 2. File path
    // 3. Start line
    mergedAll.sort((a, b) => {
      const sevDiff = compareSeverity(a.severity, b.severity);
      if (sevDiff !== 0) return sevDiff;

      const pathDiff = a.filePath.localeCompare(b.filePath);
      if (pathDiff !== 0) return pathDiff;

      return a.startLine - b.startLine;
    });

    // Enforce max findings per file and assign final category-based IDs
    const fileCount = new Map<string, number>();
    const categoryCount = new Map<string, number>();
    const finalFindings: ReviewFinding[] = [];

    for (const f of mergedAll) {
      const count = fileCount.get(f.filePath) ?? 0;
      if (count >= this.maxFindingsPerFile) continue;

      fileCount.set(f.filePath, count + 1);

      const catIndex = (categoryCount.get(f.category) ?? 0) + 1;
      categoryCount.set(f.category, catIndex);

      finalFindings.push({
        ...f,
        id: generateFindingId(f.category, catIndex),
      });
    }

    return finalFindings;
  }

  private mergeFileFindings(findings: ReviewFinding[]): ReviewFinding[] {
    const clusters: ReviewFinding[][] = [];

    for (const finding of findings) {
      let matchedCluster: ReviewFinding[] | null = null;

      for (const cluster of clusters) {
        // Check if finding overlaps with any finding in cluster
        const overlaps = cluster.some((existing) => this.isOverlapping(existing, finding));
        if (overlaps) {
          matchedCluster = cluster;
          break;
        }
      }

      if (matchedCluster) {
        matchedCluster.push(finding);
      } else {
        clusters.push([finding]);
      }
    }

    return clusters.map((cluster) => this.combineCluster(cluster));
  }

  private isOverlapping(a: ReviewFinding, b: ReviewFinding): boolean {
    if (a.filePath !== b.filePath) return false;

    // Check line range overlap with tolerance
    const aStart = Math.max(1, a.startLine - this.lineTolerance);
    const aEnd = a.endLine + this.lineTolerance;
    const bStart = Math.max(1, b.startLine - this.lineTolerance);
    const bEnd = b.endLine + this.lineTolerance;

    const linesOverlap = aStart <= bEnd && bStart <= aEnd;

    // Direct line overlap with same or related category
    if (linesOverlap) {
      if (a.category === b.category) return true;
      // Cross-verification: tsc/semgrep often aligns with bug/security
      const hasStatic = a.verifiedBy.some((v) => v !== 'llm') || b.verifiedBy.some((v) => v !== 'llm');
      if (hasStatic) return true;
    }

    return false;
  }

  private combineCluster(cluster: ReviewFinding[]): ReviewFinding {
    if (cluster.length === 1) {
      return cluster[0]!;
    }

    // 1. Resolve highest severity
    let highestSeverity: ReviewSeverity = 'info';
    for (const f of cluster) {
      if (compareSeverity(f.severity, highestSeverity) < 0) {
        highestSeverity = f.severity;
      }
    }

    // 2. Merge verifiedBy list
    const verifiedSet = new Set<VerificationMethod>();
    cluster.forEach((f) => f.verifiedBy.forEach((v) => verifiedSet.add(v)));
    const mergedVerifiedBy = Array.from(verifiedSet);

    // 3. Compute boosted confidence
    const hasStaticTool = mergedVerifiedBy.some((v) => v === 'tsc' || v === 'semgrep' || v === 'eslint');
    let confidence = Math.max(...cluster.map((f) => f.confidence));

    if (hasStaticTool) {
      // Deterministic static analysis elevates confidence to near 100%
      confidence = Math.max(confidence, 0.98);
    } else if (cluster.length > 1) {
      // Multiple specialized AI agents agreeing on the same code defect
      confidence = Math.min(1.0, confidence + 0.1 * (cluster.length - 1));
    }

    // 4. Select primary finding to inherit core text & patch
    // Prefer static tool finding or highest confidence finding
    const primary =
      cluster.find((f) => f.verifiedBy.some((v) => v !== 'llm')) ||
      cluster.reduce((best, cur) => (cur.confidence > best.confidence ? cur : best), cluster[0]!);

    // Span union
    const startLine = Math.min(...cluster.map((f) => f.startLine));
    const endLine = Math.max(...cluster.map((f) => f.endLine));

    // Best patch and test
    const patch = cluster.find((f) => f.suggestedPatch)?.suggestedPatch;
    const test = cluster.find((f) => f.suggestedTest)?.suggestedTest;

    // Combine blast radius
    const blastSet = new Set<string>();
    cluster.forEach((f) => f.blastRadius?.forEach((b) => blastSet.add(b)));
    const mergedBlast = blastSet.size > 0 ? Array.from(blastSet) : undefined;

    return {
      id: primary.id,
      category: primary.category,
      severity: highestSeverity,
      confidence: Number(confidence.toFixed(2)),
      filePath: primary.filePath,
      startLine,
      endLine,
      symbolName: primary.symbolName,
      title: primary.title,
      explanation: primary.explanation,
      evidence: primary.evidence,
      blastRadius: mergedBlast,
      suggestedPatch: patch,
      suggestedTest: test,
      verifiedBy: mergedVerifiedBy,
    };
  }
}
