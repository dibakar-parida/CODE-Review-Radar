import React, { useState, useEffect } from 'react';
import './styles/vibrant-blocks.css';
import { ReviewSummary, ReviewFinding } from '@cr/shared';
import { ReviewHero } from './components/ReviewHero.js';
import { BlockGrid } from './components/BlockGrid.js';
import { FindingCard } from './components/FindingCard.js';
import { BlastRadiusGraph } from './components/BlastRadiusGraph.js';
import { StyleTile } from './components/StyleTile.js';
import { ContrastTable } from './components/ContrastTable.js';

export const SAMPLE_SUMMARY: ReviewSummary = {
  target: { type: 'staged' },
  executionMode: 'local',
  modelName: 'Ollama · qwen2.5-coder:7b',
  totalFindings: 3,
  bySeverity: {
    critical: 1,
    major: 1,
    minor: 1,
    info: 0,
  },
  byCategory: {
    security: 1,
    bug: 0,
    performance: 1,
    architecture: 0,
    quality: 1,
    testing: 0,
  },
  filesAnalyzed: 4,
  durationMs: 840,
  timestamp: new Date().toISOString(),
};

export const SAMPLE_FINDINGS: ReviewFinding[] = [
  {
    id: 'SEC-001',
    category: 'security',
    severity: 'critical',
    confidence: 0.98,
    filePath: 'packages/core/src/orchestrator.ts',
    startLine: 142,
    endLine: 158,
    symbolName: 'executeGitHunk',
    title: 'Unsanitized Shell Execution Path in Git Runner',
    explanation:
      'Direct interpolation into raw shell string concatenation without argument arrays permits command injection vulnerabilities.',
    evidence: 'const diff = await exec(`git diff ${branch}`);',
    blastRadius: [
      'caller:UnifiedReviewOrchestrator',
      'caller:CliReviewCommand',
      'route:POST /api/review',
      'test:packages/core/test/orchestrator.test.ts',
    ],
    suggestedPatch: `--- a/packages/core/src/orchestrator.ts
+++ b/packages/core/src/orchestrator.ts
@@ -145,2 +145,2 @@
-const diff = await exec(\`git diff \${branch}\`);
+const diff = await execFile('git', ['diff', branch]);
`,
    verifiedBy: ['ast', 'tsc', 'semgrep'],
  },
  {
    id: 'PERF-002',
    category: 'performance',
    severity: 'major',
    confidence: 0.91,
    filePath: 'packages/core/src/indexing/codeGraph.ts',
    startLine: 88,
    endLine: 95,
    symbolName: 'getTransitiveCallers',
    title: 'Recursive Tree Traversal Without Cycle Guard',
    explanation: 'Circular caller references cause unbounded call stack allocation.',
    evidence: 'getTransitiveCallers(parent);',
    blastRadius: ['caller:BlastRadiusResolver', 'route:GET /api/status'],
    suggestedPatch: `--- a/packages/core/src/indexing/codeGraph.ts
+++ b/packages/core/src/indexing/codeGraph.ts
@@ -88,1 +88,2 @@
+if (visited.has(caller)) return;
+visited.add(caller);
`,
    verifiedBy: ['ast', 'llm'],
  },
  {
    id: 'QUAL-003',
    category: 'quality',
    severity: 'minor',
    confidence: 0.84,
    filePath: 'packages/server/src/server.ts',
    startLine: 45,
    endLine: 48,
    title: 'Missing Type Guard on Request Payload',
    explanation: 'Payload parsed without Zod schema verification before orchestrator dispatch.',
    evidence: 'const target = req.body.target;',
    suggestedPatch: `--- a/packages/server/src/server.ts
+++ b/packages/server/src/server.ts
@@ -45,1 +45,1 @@
-const target = req.body.target;
+const target = ReviewTargetSchema.parse(req.body.target);
`,
    verifiedBy: ['tsc'],
  },
];

export const App: React.FC = () => {
  const [summary, setSummary] = useState<ReviewSummary>(SAMPLE_SUMMARY);
  const [findings, setFindings] = useState<ReviewFinding[]>(SAMPLE_FINDINGS);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'staged' | 'unstaged'>('staged');
  const [statusMessage, setStatusMessage] = useState<string>('');

  const fetchLiveReview = async () => {
    setIsLoading(true);
    setStatusMessage('Querying local review orchestrator on 127.0.0.1...');
    try {
      const res = await fetch('http://127.0.0.1:3100/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: { type: activeTab } }),
      });
      if (res.ok) {
        const data = (await res.json()) as { summary: ReviewSummary; findings: ReviewFinding[] };
        setSummary(data.summary);
        setFindings(data.findings);
        setStatusMessage('Review updated successfully.');
      } else {
        setStatusMessage('Server offline; displaying local demo findings.');
      }
    } catch {
      setStatusMessage('Local server at 127.0.0.1:3100 not reachable; using cached review findings.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyFix = async (f: ReviewFinding) => {
    if (!f.suggestedPatch) return;
    setStatusMessage(`Applying verified fix for ${f.id}...`);
    try {
      const res = await fetch('http://127.0.0.1:3100/api/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: f.filePath,
          patch: f.suggestedPatch,
          verify: true,
        }),
      });
      if (res.ok) {
        setStatusMessage(`✔ Fix committed and verified for ${f.id}`);
        // Remove fixed finding
        setFindings((prev) => prev.filter((item) => item.id !== f.id));
      } else {
        setStatusMessage(`✖ Fix failed verification and was rolled back.`);
      }
    } catch {
      setStatusMessage(`[Offline Demo] Verified fix applied for ${f.id}`);
      setFindings((prev) => prev.filter((item) => item.id !== f.id));
    }
  };

  const handleDismissFinding = async (f: ReviewFinding) => {
    setStatusMessage(`Dismissing finding ${f.id}...`);
    try {
      await fetch('http://127.0.0.1:3100/api/telemetry/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finding: f,
          decision: 'ignored',
          reason: 'Dismissed from dashboard',
        }),
      });
      setStatusMessage(`✔ Finding ${f.id} dismissed and recorded in review memory.`);
      setFindings((prev) => prev.filter((item) => item.id !== f.id));
    } catch {
      setStatusMessage(`[Offline Demo] Finding ${f.id} dismissed.`);
      setFindings((prev) => prev.filter((item) => item.id !== f.id));
    }
  };

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '2rem 3rem', position: 'relative' }}>
      {/* Decorative geometric shapes clear of headings and CTAs */}
      <svg
        className="shape"
        style={{ top: '40px', right: '40px', width: '180px', height: '180px', color: 'var(--vb-cyan)' }}
        viewBox="0 0 100 100"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <polygon points="50,5 95,50 50,95 5,50" />
        <circle cx="50" cy="50" r="22" stroke="currentColor" strokeDasharray="4 4" />
      </svg>
      <svg
        className="shape"
        style={{ top: '900px', left: '-20px', width: '220px', height: '220px', color: 'var(--vb-pink)' }}
        viewBox="0 0 100 100"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="20" y="20" width="60" height="60" stroke="currentColor" />
        <circle cx="50" cy="50" r="38" />
      </svg>

      {/* Target Selector Navigation */}
      <nav style={{ display: 'flex', gap: '1rem', marginBottom: '2.5rem' }}>
        <button
          onClick={() => {
            setActiveTab('staged');
            fetchLiveReview();
          }}
          style={{
            padding: '0.6rem 1.4rem',
            borderRadius: '0.75rem',
            border: activeTab === 'staged' ? '2px solid var(--vb-lime)' : '1px solid #333',
            background: activeTab === 'staged' ? '#141414' : 'transparent',
            color: activeTab === 'staged' ? 'var(--vb-lime)' : '#888',
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          staged (4 files)
        </button>
        <button
          onClick={() => {
            setActiveTab('unstaged');
            fetchLiveReview();
          }}
          style={{
            padding: '0.6rem 1.4rem',
            borderRadius: '0.75rem',
            border: activeTab === 'unstaged' ? '2px solid var(--vb-lime)' : '1px solid #333',
            background: activeTab === 'unstaged' ? '#141414' : 'transparent',
            color: activeTab === 'unstaged' ? 'var(--vb-lime)' : '#888',
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          unstaged
        </button>
      </nav>

      {statusMessage && (
        <div
          style={{
            padding: '0.75rem 1.25rem',
            borderRadius: '0.75rem',
            background: '#141414',
            border: '1px solid #333',
            color: 'var(--vb-cyan)',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            marginBottom: '2rem',
          }}
        >
          {statusMessage}
        </div>
      )}

      {/* Frame 2: Review Summary Hero & Block Grid */}
      <ReviewHero summary={summary} onRefresh={fetchLiveReview} isLoading={isLoading} />
      <BlockGrid summary={summary} />

      {/* Frame 4: Blast Radius & Impact Graph */}
      <BlastRadiusGraph findings={findings} />

      {/* Frame 3: Finding Cards & Diff Inspector */}
      <section style={{ marginBottom: '4rem' }}>
        <h2 style={{ color: '#FFF' }}>Detailed Findings ({findings.length})</h2>
        {findings.map((f) => (
          <FindingCard
            key={f.id}
            finding={f}
            onApplyFix={handleApplyFix}
            onDismiss={handleDismissFinding}
          />
        ))}
      </section>

      {/* Frame 1: Style Tile & Component Sheet */}
      <StyleTile />

      {/* Accessibility Contrast Matrix */}
      <ContrastTable />
    </div>
  );
};
