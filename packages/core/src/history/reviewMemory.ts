import * as crypto from 'node:crypto';
import { ReviewFinding } from '@cr/shared';
import { SQLiteStorage } from '../indexing/sqliteStorage.js';

export interface DecisionRecord {
  findingId: string;
  category: string;
  title: string;
  filePath: string;
  decision: 'accepted' | 'ignored';
  reason?: string;
  createdAt: string;
}

export class ReviewMemory {
  private readonly storage: SQLiteStorage;

  constructor(storage: SQLiteStorage) {
    this.storage = storage;
  }

  /**
   * Generates a stable deterministic pattern hash for a finding.
   */
  computePatternHash(finding: ReviewFinding): string {
    // Normalizes title and stripped evidence to match the conceptual defect pattern
    const cleanTitle = finding.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanEvidence = (finding.evidence || '').trim().replace(/\s+/g, ' ');
    const raw = `${finding.category}:${cleanTitle}:${cleanEvidence}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  /**
   * Records whether a finding was approved/accepted by developers or ignored as a false positive.
   */
  recordDecision(finding: ReviewFinding, decision: 'accepted' | 'ignored', reason?: string): void {
    const hash = this.computePatternHash(finding);
    this.storage.recordDecision(hash, finding.category, finding.title, finding.filePath, decision, reason);
  }

  /**
   * Checks if a finding matches a previously dismissed/ignored pattern.
   */
  isIgnored(finding: ReviewFinding): boolean {
    const ignoredHashes = this.storage.getIgnoredHashes();
    const hash = this.computePatternHash(finding);
    return ignoredHashes.has(hash);
  }

  /**
   * Filters out previously ignored findings and returns active vs. suppressed lists.
   */
  filterIgnoredFindings(findings: ReviewFinding[]): { active: ReviewFinding[]; suppressed: ReviewFinding[] } {
    const ignoredHashes = this.storage.getIgnoredHashes();
    const active: ReviewFinding[] = [];
    const suppressed: ReviewFinding[] = [];

    for (const f of findings) {
      const hash = this.computePatternHash(f);
      if (ignoredHashes.has(hash)) {
        suppressed.push(f);
      } else {
        active.push(f);
      }
    }

    return { active, suppressed };
  }

  /**
   * Formats repository conventions learned from accepted findings for prompt injection.
   */
  getConventionsContext(): string {
    const conventions = this.storage.getLearnedConventions();
    if (conventions.length === 0) return '';

    const lines: string[] = [
      'Learned Repository Conventions & Accepted Patterns (adhere to these standards):',
    ];
    for (const c of conventions) {
      lines.push(`- [${c.category.toUpperCase()}] ${c.title} (accepted ${c.count}x)`);
    }

    return lines.join('\n');
  }

  /**
   * Retrieves telemetry stats summarizing developer acceptance and rejection rates by rule category.
   */
  getTelemetryStats(): Record<string, { accepted: number; ignored: number; total: number; acceptanceRate: number }> {
    return this.storage.getTelemetryStats();
  }
}
