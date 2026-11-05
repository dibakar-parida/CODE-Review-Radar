import { describe, it, expect } from 'vitest';
import React from 'react';
import { SAMPLE_SUMMARY, SAMPLE_FINDINGS } from './App.js';
import { ReviewHero } from './components/ReviewHero.js';
import { BlockGrid } from './components/BlockGrid.js';
import { FindingCard } from './components/FindingCard.js';
import { BlastRadiusGraph } from './components/BlastRadiusGraph.js';
import { ExplainModal } from './components/ExplainModal.js';
import { GenerateTestModal } from './components/GenerateTestModal.js';
import { HotspotsPanel } from './components/HotspotsPanel.js';
import { SettingsModal } from './components/SettingsModal.js';

describe('@cr/dashboard Vibrant & Block-Based Component Architecture', () => {
  it('instantiates ReviewHero with local mode indicator and display title', () => {
    const hero = <ReviewHero summary={SAMPLE_SUMMARY} />;
    expect(hero).toBeDefined();
    expect(hero.props.summary.executionMode).toBe('local');
    expect(hero.props.summary.modelName).toContain('Ollama');
  });

  it('instantiates 4-color BlockGrid with critical, major, minor, and confidence metrics', () => {
    const grid = <BlockGrid summary={SAMPLE_SUMMARY} />;
    expect(grid).toBeDefined();
    expect(grid.props.summary.bySeverity.critical).toBe(1);
    expect(grid.props.summary.bySeverity.major).toBe(1);
    expect(grid.props.summary.bySeverity.minor).toBe(1);
  });

  it('instantiates FindingCard with unified patch and verification badges', () => {
    const finding = SAMPLE_FINDINGS[0]!;
    const card = <FindingCard finding={finding} />;
    expect(card).toBeDefined();
    expect(card.props.finding.id).toBe('SEC-001');
    expect(card.props.finding.suggestedPatch).toBeDefined();
    expect(card.props.finding.verifiedBy).toContain('ast');
  });

  it('instantiates BlastRadiusGraph mapping callers, routes, and tests', () => {
    const graph = <BlastRadiusGraph findings={SAMPLE_FINDINGS} />;
    expect(graph).toBeDefined();
    expect(graph.props.findings.length).toBe(3);
    const blast = graph.props.findings[0]!.blastRadius!;
    expect(blast.some((b: string) => b.startsWith('caller:'))).toBe(true);
    expect(blast.some((b: string) => b.startsWith('route:'))).toBe(true);
  });

  it('instantiates ExplainModal with finding context and blast radius', () => {
    const finding = SAMPLE_FINDINGS[0]!;
    const modal = (
      <ExplainModal
        finding={finding}
        data={{
          findingId: finding.id,
          title: finding.title,
          explanation: finding.explanation,
          snippet: finding.evidence,
          blastRadius: finding.blastRadius,
        }}
        isLoading={false}
        onClose={() => {}}
      />
    );
    expect(modal).toBeDefined();
    expect(modal.props.finding.id).toBe('SEC-001');
    expect(modal.props.data?.snippet).toContain('git diff');
  });

  it('instantiates GenerateTestModal with synthesized Vitest code', () => {
    const finding = SAMPLE_FINDINGS[0]!;
    const modal = (
      <GenerateTestModal
        finding={finding}
        data={{
          testFilePath: 'packages/core/src/orchestrator.test.ts',
          testCode: "describe('regression', () => { it('works', () => expect(true).toBe(true)); });",
        }}
        isLoading={false}
        onClose={() => {}}
      />
    );
    expect(modal).toBeDefined();
    expect(modal.props.data?.testFilePath).toContain('orchestrator.test.ts');
    expect(modal.props.data?.testCode).toContain('regression');
  });

  it('instantiates HotspotsPanel with commit churn metrics', () => {
    const hotspots = [
      {
        filePath: 'packages/core/src/auth.ts',
        commitCount: 4,
        linesAdded: 80,
        linesDeleted: 20,
        totalChanges: 100,
        churnScore: 45.2,
        isHotspot: true,
      },
    ];
    const panel = <HotspotsPanel hotspots={hotspots} />;
    expect(panel).toBeDefined();
    expect(panel.props.hotspots[0]!.filePath).toBe('packages/core/src/auth.ts');
    expect(panel.props.hotspots[0]!.isHotspot).toBe(true);
  });

  it('instantiates SettingsModal dialog', () => {
    const modal = <SettingsModal onClose={() => {}} />;
    expect(modal).toBeDefined();
  });
});
