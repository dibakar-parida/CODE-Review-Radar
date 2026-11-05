import React from 'react';
import { ReviewSummary } from '@cr/shared';

interface ReviewHeroProps {
  summary: ReviewSummary;
  onRefresh?: () => void;
  isLoading?: boolean;
}

export const ReviewHero: React.FC<ReviewHeroProps> = ({ summary, onRefresh, isLoading }) => {
  return (
    <div style={{ marginBottom: '3rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.5rem', fontWeight: 900, color: 'var(--vb-lime)' }}>cr</span>
          <span style={{ height: '1.5rem', width: '2px', background: '#333' }} />
          <span style={{ fontSize: '0.85rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
            Unified Review Radar
          </span>
        </div>

        {/* Local · Ollama active pill */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '0.4rem 1rem',
            borderRadius: '999px',
            background: '#141414',
            border: '1px solid #262626',
            fontSize: '0.8rem',
            fontFamily: 'monospace',
            fontWeight: 700,
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--vb-chartreuse)',
              boxShadow: '0 0 10px var(--vb-chartreuse)',
            }}
          />
          <span style={{ color: '#FFFFFF' }}>{summary.executionMode.toUpperCase()} · {summary.modelName}</span>
        </div>
      </div>

      <h1>CODE REVIEW RADAR</h1>
      <p style={{ color: '#AAA', fontSize: '1.25rem', maxWidth: '48rem', marginTop: '1rem', lineHeight: 1.5 }}>
        Local-First AI Code Intelligence. AST call-graph validated, zero network egress, deterministic verification.
      </p>

      {onRefresh && (
        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
          <button
            className="button"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Re-run review analysis"
            style={{ fontSize: '1rem', padding: '0.8rem 1.8rem' }}
          >
            {isLoading ? 'Running Analysis...' : '⚡ Re-Run Review'}
          </button>
        </div>
      )}
    </div>
  );
};
