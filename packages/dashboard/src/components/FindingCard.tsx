import React from 'react';
import { ReviewFinding } from '@cr/shared';

interface FindingCardProps {
  finding: ReviewFinding;
  onApplyFix?: (finding: ReviewFinding) => void;
  onExplain?: (finding: ReviewFinding) => void;
  onGenerateTest?: (finding: ReviewFinding) => void;
  onDismiss?: (finding: ReviewFinding) => void;
}

export const FindingCard: React.FC<FindingCardProps> = ({
  finding,
  onApplyFix,
  onExplain,
  onGenerateTest,
  onDismiss,
}) => {
  const getSeverityColor = (sev: string) => {
    switch (sev) {
      case 'critical':
        return 'var(--vb-rose)';
      case 'major':
        return 'var(--vb-amber)';
      case 'minor':
        return 'var(--vb-cyan)';
      default:
        return '#888';
    }
  };

  const borderColor = getSeverityColor(finding.severity);

  return (
    <article className="finding-card" style={{ borderLeftColor: borderColor }}>
      {/* Header coordinates and badges */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '1rem',
          fontFamily: 'monospace',
          fontSize: '0.85rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span
            className="badge"
            style={{ background: borderColor, color: finding.severity === 'critical' ? '#FFF' : '#000' }}
          >
            {finding.id}
          </span>
          <span style={{ color: '#888', fontWeight: 700 }}>
            {finding.category.toUpperCase()} · {finding.severity.toUpperCase()}
          </span>
          <span
            style={{
              background: '#000',
              color: 'var(--vb-cyan)',
              border: '1px solid rgba(0, 255, 255, 0.3)',
              padding: '0.2rem 0.5rem',
              borderRadius: '4px',
              fontSize: '0.75rem',
            }}
          >
            conf: {(finding.confidence * 100).toFixed(0)}%
          </span>
        </div>

        <div style={{ color: '#AAA' }}>
          <span style={{ color: '#FFF' }}>{finding.filePath}</span>
          <span style={{ color: '#666' }}>:{finding.startLine}-{finding.endLine}</span>
        </div>
      </div>

      {/* Title & Explanation */}
      <h3 style={{ fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.5rem 0', color: '#FFF' }}>
        {finding.title}
      </h3>
      <p style={{ color: '#CCC', lineHeight: 1.6, marginBottom: '1.5rem', fontSize: '1rem' }}>
        {finding.explanation}
      </p>

      {/* High-contrast Monospace Code Diff Well */}
      {finding.suggestedPatch && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div
            style={{
              fontSize: '0.75rem',
              fontWeight: 800,
              color: 'var(--vb-lime)',
              fontFamily: 'monospace',
              textTransform: 'uppercase',
              marginBottom: '0.4rem',
            }}
          >
            Verified Patch Well
          </div>
          <div className="code-well">
            {finding.suggestedPatch.split('\n').map((line, idx) => {
              let color = '#AAA';
              let bg = 'transparent';
              if (line.startsWith('+')) {
                color = 'var(--vb-lime)';
                bg = 'rgba(57, 255, 20, 0.08)';
              } else if (line.startsWith('-')) {
                color = 'var(--vb-rose)';
                bg = 'rgba(255, 0, 110, 0.12)';
              } else if (line.startsWith('@@')) {
                color = 'var(--vb-cyan)';
              }
              return (
                <div key={idx} style={{ color, background: bg, padding: '2px 4px', borderRadius: '2px' }}>
                  {line}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Action Button Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginTop: '1.5rem',
        }}
      >
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {finding.suggestedPatch && (
            <button
              className="button"
              onClick={() => onApplyFix?.(finding)}
              aria-label={`Apply verified patch for ${finding.id}`}
              style={{ fontSize: '0.9rem', padding: '0.6rem 1.4rem' }}
            >
              <span>⚡ Apply Fix</span>
            </button>
          )}

          <button
            onClick={() => onExplain?.(finding)}
            aria-label={`Explain context for ${finding.id}`}
            style={{
              background: '#000',
              border: '2px solid var(--vb-cyan)',
              color: 'var(--vb-cyan)',
              fontWeight: 800,
              padding: '0.6rem 1.2rem',
              borderRadius: '0.8rem',
              cursor: 'pointer',
            }}
          >
            Explain Context
          </button>

          <button
            onClick={() => onGenerateTest?.(finding)}
            aria-label={`Generate Vitest test case for ${finding.id}`}
            style={{
              background: '#000',
              border: '2px solid var(--vb-amber)',
              color: 'var(--vb-amber)',
              fontWeight: 800,
              padding: '0.6rem 1.2rem',
              borderRadius: '0.8rem',
              cursor: 'pointer',
            }}
          >
            Generate Test
          </button>
        </div>

        <button
          onClick={() => onDismiss?.(finding)}
          style={{
            background: 'none',
            border: 'none',
            color: '#777',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontWeight: 700,
            textTransform: 'uppercase',
            fontSize: '0.8rem',
          }}
          aria-label={`Ignore finding ${finding.id}`}
        >
          Ignore Finding
        </button>
      </div>
    </article>
  );
};
