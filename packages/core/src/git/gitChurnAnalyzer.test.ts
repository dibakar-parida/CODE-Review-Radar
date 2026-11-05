import { describe, it, expect } from 'vitest';
import { GitChurnAnalyzer } from './gitChurnAnalyzer.js';

describe('GitChurnAnalyzer', () => {
  const sampleNumstatOutput = `
COMMIT:c1a2b3c
10\t2\tpackages/core/src/auth.ts
5\t0\tpackages/shared/src/types.ts

COMMIT:d4e5f6a
25\t15\tpackages/core/src/auth.ts
2\t2\tpackages/cli/src/main.ts

COMMIT:789abc0
30\t10\tpackages/core/src/auth.ts
1\t1\tREADME.md
`;

  it('correctly aggregates commit count and changes per file', () => {
    const analyzer = new GitChurnAnalyzer();
    const metrics = analyzer.parseNumstat(sampleNumstatOutput, 0.75);

    expect(metrics.length).toBe(4);

    const authMetric = metrics.find((m) => m.filePath === 'packages/core/src/auth.ts');
    expect(authMetric).toBeDefined();
    expect(authMetric!.commitCount).toBe(3);
    expect(authMetric!.linesAdded).toBe(65);
    expect(authMetric!.linesDeleted).toBe(27);
    expect(authMetric!.totalChanges).toBe(92);
    expect(authMetric!.isHotspot).toBe(true);
  });

  it('ranks hotspots by descending churn score', () => {
    const analyzer = new GitChurnAnalyzer();
    const metrics = analyzer.parseNumstat(sampleNumstatOutput, 0.5);

    expect(metrics[0]!.filePath).toBe('packages/core/src/auth.ts');
    for (let i = 1; i < metrics.length; i++) {
      expect(metrics[i - 1]!.churnScore).toBeGreaterThanOrEqual(metrics[i]!.churnScore);
    }
  });

  it('gracefully handles empty git output', () => {
    const analyzer = new GitChurnAnalyzer();
    const metrics = analyzer.parseNumstat('', 0.85);
    expect(metrics).toEqual([]);
  });
});
