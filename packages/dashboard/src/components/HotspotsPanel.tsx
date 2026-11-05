import React from 'react';

export interface HotspotMetric {
  filePath: string;
  commitCount: number;
  linesAdded: number;
  linesDeleted: number;
  totalChanges: number;
  churnScore: number;
  isHotspot: boolean;
}

interface HotspotsPanelProps {
  hotspots: HotspotMetric[];
  isLoading?: boolean;
}

export const HotspotsPanel: React.FC<HotspotsPanelProps> = ({ hotspots, isLoading }) => {
  if (isLoading) {
    return (
      <div className="block" style={{ marginBottom: '3rem', padding: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem 0', color: '#FFF' }}>🔥 Repository Churn & Hotspot Analysis</h3>
        <div style={{ color: 'var(--vb-cyan)', fontFamily: 'monospace' }}>Scanning Git commit logs...</div>
      </div>
    );
  }

  if (hotspots.length === 0) {
    return null;
  }

  return (
    <section className="block" style={{ marginBottom: '3rem', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.3rem', color: '#FFF', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>🔥</span>
            <span>Git Churn & Hotspot Analysis</span>
          </h3>
          <p style={{ margin: '0.3rem 0 0 0', color: '#888', fontSize: '0.85rem' }}>
            Modules with high commit frequency and high code volatility receive elevated review scrutiny.
          </p>
        </div>
        <span
          className="badge"
          style={{ background: 'var(--vb-pink)', color: '#000', fontWeight: 800 }}
        >
          {hotspots.filter((h) => h.isHotspot).length} Hotspots Detected
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {hotspots.slice(0, 5).map((hotspot) => (
          <div
            key={hotspot.filePath}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.75rem 1rem',
              background: '#0D0D0D',
              border: hotspot.isHotspot ? '1px solid var(--vb-pink)' : '1px solid #222',
              borderRadius: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ fontFamily: 'monospace', color: '#FFF', fontWeight: 700 }}>
                {hotspot.filePath}
              </span>
              <span style={{ fontSize: '0.8rem', color: '#777' }}>
                {hotspot.commitCount} commits · +{hotspot.linesAdded} / -{hotspot.linesDeleted} lines
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--vb-cyan)' }}>
                Score: {hotspot.churnScore}
              </span>
              {hotspot.isHotspot && (
                <span
                  style={{
                    background: 'rgba(255, 20, 147, 0.2)',
                    color: 'var(--vb-pink)',
                    border: '1px solid var(--vb-pink)',
                    padding: '0.2rem 0.5rem',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                  }}
                >
                  HIGH VOLATILITY
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
