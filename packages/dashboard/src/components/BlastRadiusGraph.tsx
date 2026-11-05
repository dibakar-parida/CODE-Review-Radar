import React from 'react';
import { ReviewFinding } from '@cr/shared';

interface BlastRadiusGraphProps {
  findings: ReviewFinding[];
}

export const BlastRadiusGraph: React.FC<BlastRadiusGraphProps> = ({ findings }) => {
  const blastItems: string[] = [];
  findings.forEach((f) => f.blastRadius?.forEach((b) => blastItems.push(b)));
  const uniqueBlast = Array.from(new Set(blastItems));

  const callers = uniqueBlast.filter((b) => b.startsWith('caller:')).map((b) => b.slice(7));
  const routes = uniqueBlast.filter((b) => b.startsWith('route:')).map((b) => b.slice(6));
  const tests = uniqueBlast.filter((b) => b.startsWith('test:')).map((b) => b.slice(5));

  return (
    <section
      style={{
        background: '#141414',
        border: '2px solid #262626',
        borderRadius: '1.5rem',
        padding: '2.5rem',
        marginBottom: '3rem',
      }}
    >
      <div style={{ marginBottom: '2rem' }}>
        <span
          style={{
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            color: 'var(--vb-cyan)',
            fontWeight: 900,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          AST Call Graph Radar
        </span>
        <h2 style={{ color: '#FFF', margin: '0.5rem 0' }}>Blast Radius & Impact Map</h2>
        <p style={{ color: '#AAA', fontSize: '1rem', margin: 0 }}>
          Downstream callers, affected API endpoints, and covering test suites impacted by modified symbols.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1.5rem',
        }}
      >
        {/* Callers Column */}
        <div style={{ background: '#080808', border: '1px solid #222', borderRadius: '1rem', padding: '1.5rem' }}>
          <div style={{ color: 'var(--vb-purple)', fontWeight: 800, fontSize: '0.9rem', marginBottom: '1rem', textTransform: 'uppercase' }}>
            Downstream Callers ({callers.length})
          </div>
          {callers.length === 0 ? (
            <div style={{ color: '#666', fontSize: '0.85rem' }}>No external callers mapped</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {callers.map((c, i) => (
                <div
                  key={i}
                  style={{
                    padding: '0.5rem 0.75rem',
                    background: '#141414',
                    border: '1px solid rgba(191, 0, 255, 0.3)',
                    borderRadius: '0.5rem',
                    color: '#EEE',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                >
                  ⚡ {c}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Affected Routes Column */}
        <div style={{ background: '#080808', border: '1px solid #222', borderRadius: '1rem', padding: '1.5rem' }}>
          <div style={{ color: 'var(--vb-cyan)', fontWeight: 800, fontSize: '0.9rem', marginBottom: '1rem', textTransform: 'uppercase' }}>
            Impacted API Endpoints ({routes.length})
          </div>
          {routes.length === 0 ? (
            <div style={{ color: '#666', fontSize: '0.85rem' }}>No routes impacted directly</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {routes.map((r, i) => (
                <div
                  key={i}
                  style={{
                    padding: '0.5rem 0.75rem',
                    background: '#141414',
                    border: '1px solid rgba(0, 255, 255, 0.3)',
                    borderRadius: '0.5rem',
                    color: '#EEE',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                >
                  🌐 {r}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Test Suites Column */}
        <div style={{ background: '#080808', border: '1px solid #222', borderRadius: '1rem', padding: '1.5rem' }}>
          <div style={{ color: 'var(--vb-lime)', fontWeight: 800, fontSize: '0.9rem', marginBottom: '1rem', textTransform: 'uppercase' }}>
            Covering Test Suites ({tests.length})
          </div>
          {tests.length === 0 ? (
            <div style={{ color: '#666', fontSize: '0.85rem' }}>No matching unit tests found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {tests.map((t, i) => (
                <div
                  key={i}
                  style={{
                    padding: '0.5rem 0.75rem',
                    background: '#141414',
                    border: '1px solid rgba(57, 255, 20, 0.3)',
                    borderRadius: '0.5rem',
                    color: '#EEE',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                >
                  🧪 {t}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
