import React, { useState, useEffect } from 'react';
import './styles/vibrant-blocks.css';
import { ReviewSummary, ReviewFinding } from '@cr/shared';
import { ReviewHero } from './components/ReviewHero.js';
import { BlockGrid } from './components/BlockGrid.js';
import { FindingCard } from './components/FindingCard.js';
import { BlastRadiusGraph } from './components/BlastRadiusGraph.js';
import { StyleTile } from './components/StyleTile.js';
import { ContrastTable } from './components/ContrastTable.js';
import { ExplainModal, ExplainData } from './components/ExplainModal.js';
import { GenerateTestModal, GeneratedTestData } from './components/GenerateTestModal.js';
import { SettingsModal } from './components/SettingsModal.js';
import { HotspotsPanel, HotspotMetric } from './components/HotspotsPanel.js';

export const INITIAL_SUMMARY: ReviewSummary = {
  target: { type: 'staged' },
  executionMode: 'local',
  modelName: 'Ollama · qwen2.5-coder:7b',
  totalFindings: 0,
  bySeverity: {
    critical: 0,
    major: 0,
    minor: 0,
    info: 0,
  },
  byCategory: {
    security: 0,
    bug: 0,
    performance: 0,
    architecture: 0,
    quality: 0,
    testing: 0,
  },
  filesAnalyzed: 0,
  durationMs: 0,
  timestamp: new Date().toISOString(),
};

/**
 * Fixture data exported for unit testing component isolated states.
 */
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
  const [summary, setSummary] = useState<ReviewSummary>(INITIAL_SUMMARY);
  const [findings, setFindings] = useState<ReviewFinding[]>([]);
  const [hotspots, setHotspots] = useState<HotspotMetric[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isHotspotsLoading, setIsHotspotsLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'staged' | 'unstaged'>('staged');
  const [statusMessage, setStatusMessage] = useState<string>('Ready for review.');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modals state
  const [explainFinding, setExplainFinding] = useState<ReviewFinding | null>(null);
  const [explainData, setExplainData] = useState<ExplainData | null>(null);
  const [isExplaining, setIsExplaining] = useState<boolean>(false);

  const [testFinding, setTestFinding] = useState<ReviewFinding | null>(null);
  const [testData, setTestData] = useState<GeneratedTestData | null>(null);
  const [isGeneratingTest, setIsGeneratingTest] = useState<boolean>(false);

  const [showSettings, setShowSettings] = useState<boolean>(false);

  // Initialize live WebSocket progress stream
  useEffect(() => {
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket('ws://127.0.0.1:3100/events/progress');
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.stage) {
            setStatusMessage(`[${payload.stage.toUpperCase()}] ${payload.detail || ''}`);
          }
        } catch {
          // ignore
        }
      };
      ws.onerror = () => {
        // ws quiet fallback
      };
    } catch {
      // ignore
    }

    // Load initial hotspots and system health
    fetchHotspots();

    return () => {
      ws?.close();
    };
  }, []);

  const fetchHotspots = async () => {
    setIsHotspotsLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:3100/api/hotspots');
      if (res.ok) {
        const data = (await res.json()) as { hotspots?: HotspotMetric[] };
        if (data.hotspots) {
          setHotspots(data.hotspots);
        }
      }
    } catch {
      // server offline
    } finally {
      setIsHotspotsLoading(false);
    }
  };

  const fetchLiveReview = async (targetType: 'staged' | 'unstaged' = activeTab) => {
    setIsLoading(true);
    setErrorMessage(null);
    setStatusMessage(`Running ${targetType} review against local orchestrator...`);
    try {
      const res = await fetch('http://127.0.0.1:3100/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: { type: targetType } }),
      });
      if (res.ok) {
        const data = (await res.json()) as { summary: ReviewSummary; findings: ReviewFinding[] };
        setSummary(data.summary);
        setFindings(data.findings);
        setStatusMessage(`Review complete: ${data.findings.length} finding(s) found.`);
      } else {
        const errText = await res.text();
        setErrorMessage(`Server review error: ${errText || res.statusText}`);
        setStatusMessage('Review failed.');
      }
    } catch (err: unknown) {
      setErrorMessage(`Cannot reach local server on 127.0.0.1:3100: ${(err as Error).message}`);
      setStatusMessage('Connection failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyFix = async (f: ReviewFinding) => {
    if (!f.suggestedPatch) return;
    setStatusMessage(`Applying verified fix for ${f.id}...`);
    setErrorMessage(null);
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
        setFindings((prev) => prev.filter((item) => item.id !== f.id));
      } else {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMessage(`Fix verification failed for ${f.id}: ${errJson.error || 'Syntax/Type verification failed'}. Changes rolled back.`);
        setStatusMessage(`✖ Fix rejected for ${f.id}`);
      }
    } catch (err: unknown) {
      setErrorMessage(`Network error attempting to apply fix: ${(err as Error).message}`);
      setStatusMessage(`✖ Connection error`);
    }
  };

  const handleDismissFinding = async (f: ReviewFinding) => {
    setStatusMessage(`Dismissing finding ${f.id}...`);
    try {
      const res = await fetch('http://127.0.0.1:3100/api/telemetry/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finding: f,
          decision: 'ignored',
          reason: 'Dismissed from dashboard UI',
        }),
      });
      if (res.ok) {
        setStatusMessage(`✔ Finding ${f.id} dismissed and suppressed in review memory.`);
        setFindings((prev) => prev.filter((item) => item.id !== f.id));
      }
    } catch (err: unknown) {
      setErrorMessage(`Failed to record dismissal: ${(err as Error).message}`);
    }
  };

  const handleExplain = async (f: ReviewFinding) => {
    setExplainFinding(f);
    setIsExplaining(true);
    setExplainData(null);
    try {
      const res = await fetch('http://127.0.0.1:3100/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finding: f }),
      });
      if (res.ok) {
        const data = (await res.json()) as ExplainData;
        setExplainData(data);
      }
    } catch {
      // fallback to finding data
      setExplainData({
        findingId: f.id,
        title: f.title,
        explanation: f.explanation,
        snippet: f.evidence,
        blastRadius: f.blastRadius,
      });
    } finally {
      setIsExplaining(false);
    }
  };

  const handleGenerateTest = async (f: ReviewFinding) => {
    setTestFinding(f);
    setIsGeneratingTest(true);
    setTestData(null);
    try {
      const res = await fetch('http://127.0.0.1:3100/api/generate-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finding: f }),
      });
      if (res.ok) {
        const data = (await res.json()) as GeneratedTestData;
        setTestData(data);
      }
    } catch {
      setTestData({
        testFilePath: `${f.filePath}.test.ts`,
        testCode: f.suggestedTest || `// Vitest test fixture for ${f.id}\nexpect(true).toBe(true);`,
      });
    } finally {
      setIsGeneratingTest(false);
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

      {/* Target Selector Navigation & Action Bar */}
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button
            onClick={() => {
              setActiveTab('staged');
              fetchLiveReview('staged');
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
            staged changes
          </button>
          <button
            onClick={() => {
              setActiveTab('unstaged');
              fetchLiveReview('unstaged');
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
            unstaged changes
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span
            className="badge"
            style={{
              background: '#141414',
              color: 'var(--vb-cyan)',
              border: '1px solid rgba(0, 255, 255, 0.4)',
              padding: '0.4rem 0.8rem',
              borderRadius: '0.5rem',
              fontSize: '0.8rem',
              fontWeight: 700,
              fontFamily: 'monospace',
            }}
          >
            ● {summary.modelName || 'Local Engine'}
          </span>
          <button
            onClick={() => setShowSettings(true)}
            style={{
              padding: '0.6rem 1.25rem',
              borderRadius: '0.75rem',
              background: '#141414',
              border: '1px solid #333',
              color: '#FFF',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>⚙ Settings</span>
          </button>
        </div>
      </nav>

      {/* Live Progress / Error Banner */}
      {errorMessage ? (
        <div
          style={{
            padding: '0.9rem 1.25rem',
            borderRadius: '0.75rem',
            background: 'rgba(255, 20, 147, 0.1)',
            border: '1px solid var(--vb-rose)',
            color: 'var(--vb-rose)',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            marginBottom: '2rem',
          }}
        >
          {errorMessage}
        </div>
      ) : statusMessage ? (
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
      ) : null}

      {/* Frame 2: Review Summary Hero & Block Grid */}
      <ReviewHero summary={summary} onRefresh={() => fetchLiveReview(activeTab)} isLoading={isLoading} />
      <BlockGrid summary={summary} />

      {/* Repository Git Churn & Hotspots */}
      <HotspotsPanel hotspots={hotspots} isLoading={isHotspotsLoading} />

      {/* Frame 4: Blast Radius & Impact Graph */}
      {findings.length > 0 && <BlastRadiusGraph findings={findings} />}

      {/* Frame 3: Finding Cards & Diff Inspector */}
      <section style={{ marginBottom: '4rem' }}>
        <h2 style={{ color: '#FFF', marginBottom: '1.5rem' }}>Detailed Findings ({findings.length})</h2>

        {findings.length === 0 ? (
          <div
            className="block"
            style={{
              padding: '3rem',
              textAlign: 'center',
              border: '2px dashed #333',
              borderRadius: '1rem',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🛡️</div>
            <h3 style={{ color: '#FFF', margin: '0 0 0.5rem 0' }}>Clean Workspace</h3>
            <p style={{ color: '#888', margin: 0 }}>
              No defects detected. Click &quot;staged changes&quot; or &quot;unstaged changes&quot; to inspect code.
            </p>
          </div>
        ) : (
          findings.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              onApplyFix={handleApplyFix}
              onExplain={handleExplain}
              onGenerateTest={handleGenerateTest}
              onDismiss={handleDismissFinding}
            />
          ))
        )}
      </section>

      {/* Frame 1: Style Tile & Component Sheet */}
      <StyleTile />

      {/* Accessibility Contrast Matrix */}
      <ContrastTable />

      {/* Interactive Modals */}
      {explainFinding && (
        <ExplainModal
          finding={explainFinding}
          data={explainData}
          isLoading={isExplaining}
          onClose={() => setExplainFinding(null)}
        />
      )}

      {testFinding && (
        <GenerateTestModal
          finding={testFinding}
          data={testData}
          isLoading={isGeneratingTest}
          onClose={() => setTestFinding(null)}
        />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onSave={(saved) => {
            setStatusMessage(`✔ Settings updated: using ${saved.provider} (${saved.model})`);
            setSummary((prev) => ({
              ...prev,
              modelName: `${saved.provider} · ${saved.model}`,
            }));
          }}
        />
      )}
    </div>
  );
};
