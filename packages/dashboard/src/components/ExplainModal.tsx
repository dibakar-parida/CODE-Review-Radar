import React from 'react';
import { ReviewFinding } from '@cr/shared';

export interface ExplainData {
  findingId: string;
  title: string;
  explanation: string;
  snippet?: string;
  blastRadius?: string[];
  suggestedPatch?: string;
  impactAnalysis?: string;
}

interface ExplainModalProps {
  finding: ReviewFinding;
  data: ExplainData | null;
  isLoading: boolean;
  onClose: () => void;
}

export const ExplainModal: React.FC<ExplainModalProps> = ({
  finding,
  data,
  isLoading,
  onClose,
}) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="explain-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1.5rem',
      }}
    >
      <div
        style={{
          backgroundColor: '#141414',
          border: '2px solid var(--vb-cyan)',
          borderRadius: '1rem',
          maxWidth: '800px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '2rem',
          color: '#FFF',
          boxShadow: '0 0 30px rgba(0, 255, 255, 0.2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span className="badge" style={{ background: 'var(--vb-cyan)', color: '#000' }}>
                {finding.id}
              </span>
              <span style={{ color: 'var(--vb-cyan)', fontWeight: 700, fontFamily: 'monospace' }}>
                {finding.category.toUpperCase()} · {finding.severity.toUpperCase()}
              </span>
            </div>
            <h2 id="explain-modal-title" style={{ fontSize: '1.4rem', margin: 0, color: '#FFF' }}>
              Deep Context: {finding.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close explanation dialog"
            style={{
              background: '#222',
              border: '1px solid #444',
              color: '#FFF',
              borderRadius: '0.5rem',
              padding: '0.4rem 0.8rem',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {isLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--vb-cyan)', fontFamily: 'monospace' }}>
            <span>⚡ Querying AST Context & Blast Radius from @cr/server...</span>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ color: '#888', textTransform: 'uppercase', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                Detailed Architectural Explanation
              </h4>
              <p style={{ color: '#DDD', lineHeight: 1.6 }}>
                {data?.explanation || finding.explanation}
              </p>
            </div>

            {data?.impactAnalysis && (
              <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#0D0D0D', borderRadius: '0.5rem', borderLeft: '4px solid var(--vb-rose)' }}>
                <h4 style={{ color: 'var(--vb-rose)', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                  Impact Assessment
                </h4>
                <div style={{ color: '#CCC', fontSize: '0.9rem' }}>{data.impactAnalysis}</div>
              </div>
            )}

            {data?.snippet && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ color: '#888', textTransform: 'uppercase', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                  Surrounding Source Code ({finding.filePath})
                </h4>
                <pre
                  style={{
                    backgroundColor: '#0A0A0A',
                    border: '1px solid #333',
                    padding: '1rem',
                    borderRadius: '0.5rem',
                    overflowX: 'auto',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                    color: 'var(--vb-lime)',
                    lineHeight: 1.4,
                  }}
                >
                  {data.snippet}
                </pre>
              </div>
            )}

            {finding.blastRadius && finding.blastRadius.length > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ color: '#888', textTransform: 'uppercase', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                  Downstream Blast Radius
                </h4>
                <ul style={{ listStyle: 'none', padding: 0 }}>
                  {finding.blastRadius.map((item, idx) => (
                    <li
                      key={idx}
                      style={{
                        padding: '0.4rem 0.8rem',
                        background: '#1A1A1A',
                        borderRadius: '4px',
                        marginBottom: '0.4rem',
                        fontFamily: 'monospace',
                        fontSize: '0.85rem',
                        color: 'var(--vb-cyan)',
                      }}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2rem' }}>
              <button
                onClick={onClose}
                className="button"
                style={{ padding: '0.6rem 1.6rem' }}
              >
                <span>Close</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
