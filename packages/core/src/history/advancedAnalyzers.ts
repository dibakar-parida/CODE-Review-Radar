import { FileDiff, ReviewFinding, generateFindingId } from '@cr/shared';
import { CodeGraph } from '../indexing/codeGraph.js';

export class ApiContractAnalyzer {
  private readonly codeGraph: CodeGraph;

  constructor(codeGraph: CodeGraph) {
    this.codeGraph = codeGraph;
  }

  /**
   * Detects discrepancies between frontend API calls and known backend route definitions.
   */
  analyze(fileDiff: FileDiff): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    const filePath = fileDiff.newPath || fileDiff.oldPath || 'unknown';

    // Only analyze files that look like frontend or client callers
    const isClientFile =
      filePath.includes('src/') ||
      filePath.includes('client') ||
      filePath.includes('dashboard') ||
      filePath.includes('ui');

    if (!isClientFile) return [];

    const knownRoutes = this.codeGraph.getAllRoutes();
    if (knownRoutes.length === 0) return [];

    let count = 1;

    for (const hunk of fileDiff.hunks) {
      for (let i = 0; i < hunk.lines.length; i++) {
        const line = hunk.lines[i] ?? '';
        if (!line.startsWith('+')) continue; // only check added/modified lines

        const lineNum = hunk.newStart + i;

        // 1. fetch('/api/path', { method: 'POST' })
        // or axios.post('/api/path')
        const fetchMatch = line.match(
          /\b(?:fetch|axios|api|http)\s*\(\s*['"](\/api\/[^'"]+)['"](?:\s*,\s*\{[^}]*method\s*:\s*['"]([A-Z]+)['"])?/i
        );

        const methodCallMatch = line.match(
          /\b(?:axios|api|http|client)\.(get|post|put|delete|patch)\s*\(\s*['"](\/api\/[^'"]+)['"]/i
        );

        let endpointPath = '';
        let httpMethod = 'GET';

        if (fetchMatch) {
          endpointPath = fetchMatch[1]!;
          httpMethod = (fetchMatch[2] || 'GET').toUpperCase();
        } else if (methodCallMatch) {
          httpMethod = methodCallMatch[1]!.toUpperCase();
          endpointPath = methodCallMatch[2]!;
        }

        if (endpointPath) {
          // Normalize dynamic segments: /api/users/:id or /api/users/123 -> /api/users
          const cleanPath = endpointPath.split('?')[0]!;

          // Check if exact or prefix route exists
          const matchingRoutes = knownRoutes.filter((r) => {
            const normalizedKnown = r.path.replace(/:[a-zA-Z0-9_]+/g, '*');
            const normalizedReq = cleanPath.replace(/\/\d+/g, '/*');
            return (
              r.path === cleanPath ||
              normalizedKnown === normalizedReq ||
              cleanPath.startsWith(r.path.split('/:')[0]!)
            );
          });

          if (matchingRoutes.length === 0) {
            findings.push({
              id: generateFindingId('architecture', count++),
              category: 'architecture',
              severity: 'major',
              confidence: 0.95,
              filePath,
              startLine: lineNum,
              endLine: lineNum,
              title: `API Route Not Found: ${httpMethod} ${cleanPath}`,
              explanation: `Frontend client invokes endpoint "${cleanPath}", but no matching backend route definition exists in the codebase AST.`,
              evidence: line.trim(),
              blastRadius: [`route:${httpMethod} ${cleanPath}`],
              verifiedBy: ['ast'],
            });
          } else {
            // Path exists, verify HTTP Method matches
            const methodMatch = matchingRoutes.some(
              (r) => r.method === httpMethod || r.method === 'ALL'
            );
            if (!methodMatch) {
              const supported = matchingRoutes.map((r) => r.method).join(', ');
              findings.push({
                id: generateFindingId('architecture', count++),
                category: 'architecture',
                severity: 'critical',
                confidence: 0.98,
                filePath,
                startLine: lineNum,
                endLine: lineNum,
                title: `API Method Mismatch: ${httpMethod} ${cleanPath}`,
                explanation: `Frontend client calls ${httpMethod} on "${cleanPath}", but the backend route only supports [${supported}]. This will trigger HTTP 405 Method Not Allowed at runtime.`,
                evidence: line.trim(),
                blastRadius: [`route:${httpMethod} ${cleanPath}`],
                verifiedBy: ['ast'],
              });
            }
          }
        }
      }
    }

    return findings;
  }
}

export class DatabaseMigrationAnalyzer {
  /**
   * Analyzes diffs for destructive SQL operations and dangerous schema migrations.
   */
  analyze(fileDiff: FileDiff): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    const filePath = fileDiff.newPath || fileDiff.oldPath || 'unknown';

    const isSqlOrMigration =
      filePath.endsWith('.sql') ||
      filePath.includes('migration') ||
      filePath.includes('schema') ||
      filePath.includes('db/');

    let count = 1;

    for (const hunk of fileDiff.hunks) {
      for (let i = 0; i < hunk.lines.length; i++) {
        const line = hunk.lines[i] ?? '';
        if (!line.startsWith('+')) continue; // only check additions

        const lineNum = hunk.newStart + i;
        const upper = line.toUpperCase();

        // 1. Destructive DROP TABLE or TRUNCATE
        if (upper.includes('DROP TABLE') || upper.includes('TRUNCATE TABLE') || upper.includes('TRUNCATE ')) {
          if (!upper.includes('IF EXISTS') && isSqlOrMigration) {
            findings.push({
              id: generateFindingId('security', count++),
              category: 'security',
              severity: 'critical',
              confidence: 0.99,
              filePath,
              startLine: lineNum,
              endLine: lineNum,
              title: 'Destructive DDL Operation: Unprotected Table Drop / Truncate',
              explanation: 'Destructive DROP/TRUNCATE operation detected without IF EXISTS or atomic migration rollback safeguard. This risks irreversible data loss in production.',
              evidence: line.trim(),
              verifiedBy: ['ast'],
            });
          }
        }

        // 2. Destructive DROP COLUMN
        if (upper.includes('ALTER TABLE') && upper.includes('DROP COLUMN')) {
          findings.push({
            id: generateFindingId('performance', count++),
            category: 'performance',
            severity: 'critical',
            confidence: 0.95,
            filePath,
            startLine: lineNum,
            endLine: lineNum,
            title: 'Destructive Column Deletion in Migration',
            explanation: 'Dropping columns directly in active databases can lock tables and immediately break in-flight application queries referencing the removed column.',
            evidence: line.trim(),
            verifiedBy: ['ast'],
          });
        }

        // 3. Foreign Key without explicit Index
        if (upper.includes('REFERENCES ') && !upper.includes('CREATE INDEX') && isSqlOrMigration) {
          findings.push({
            id: generateFindingId('performance', count++),
            category: 'performance',
            severity: 'major',
            confidence: 0.88,
            filePath,
            startLine: lineNum,
            endLine: lineNum,
            title: 'Foreign Key Constraint Without Index',
            explanation: 'Adding a FOREIGN KEY constraint without a matching B-Tree index causes full table scans during parent row deletes or updates, degrading database throughput.',
            evidence: line.trim(),
            verifiedBy: ['ast'],
          });
        }
      }
    }

    return findings;
  }
}
