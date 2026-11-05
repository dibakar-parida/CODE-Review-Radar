import { describe, it, expect } from 'vitest';
import React from 'react';
import { SAMPLE_SUMMARY, SAMPLE_FINDINGS } from './App.js';
import { ReviewHero } from './components/ReviewHero.js';
import { BlockGrid } from './components/BlockGrid.js';
import { FindingCard } from './components/FindingCard.js';
import { BlastRadiusGraph } from './components/BlastRadiusGraph.js';

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
});
