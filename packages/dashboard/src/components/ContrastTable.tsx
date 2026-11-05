import React from 'react';

export const ContrastTable: React.FC = () => {
  const rows = [
    { fg: '#000000', bg: '#39FF14', elem: 'Metric Big Counter', ratio: '15.49 : 1', standard: '≥ 3.0 : 1', status: 'PASS (AAA)' },
    { fg: '#000000', bg: '#00FFFF', elem: 'Metric Counter & Labels', ratio: '16.75 : 1', standard: '≥ 4.5 : 1', status: 'PASS (AAA)' },
    { fg: '#000000', bg: '#FFAA00', elem: 'Warning Badges', ratio: '11.00 : 1', standard: '≥ 4.5 : 1', status: 'PASS (AAA)' },
    { fg: '#000000', bg: '#FF1493', elem: 'Metric Label (Bold ≥ 18px)', ratio: '5.77 : 1', standard: '≥ 3.0 : 1', status: 'PASS (AA)' },
    { fg: '#000000', bg: '#FF1493→#BF00FF', elem: 'Primary CTA Button (≥ 18px)', ratio: '5.21 : 1', standard: '≥ 3.0 : 1', status: 'PASS (AA)' },
    { fg: '#39FF14', bg: '#0D0D0D', elem: 'Focus-Visible Ring (3px)', ratio: '14.37 : 1', standard: '≥ 3.0 : 1', status: 'PASS (AAA)' },
    { fg: '#39FF14', bg: '#141414', elem: 'Diff Additions (+)', ratio: '13.88 : 1', standard: '≥ 4.5 : 1', status: 'PASS (AAA)' },
    { fg: '#FF006E', bg: '#141414', elem: 'Diff Deletions (-)', ratio: '4.82 : 1', standard: '≥ 4.5 : 1', status: 'PASS (AA)' },
    { fg: '#FFFFFF', bg: '#141414', elem: 'Finding Headings & Sources', ratio: '17.85 : 1', standard: '≥ 4.5 : 1', status: 'PASS (AAA)' },
  ];

  return (
    <section
      style={{
        background: '#141414',
        border: '2px solid #262626',
        borderRadius: '1.5rem',
        padding: '2.5rem',
        marginBottom: '4rem',
      }}
    >
      <div style={{ marginBottom: '1.5rem' }}>
        <span
          style={{
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            color: 'var(--vb-chartreuse)',
            fontWeight: 900,
            textTransform: 'uppercase',
          }}
        >
          Accessibility Verification
        </span>
        <h2 style={{ color: '#FFF', margin: '0.5rem 0' }}>WCAG 2.1 AA Contrast Compliance</h2>
        <p style={{ color: '#AAA', fontSize: '0.9rem', margin: 0 }}>
          Strict contrast compliance table verified for normal text (≥ 4.5:1) and large display elements (≥ 3.0:1).
        </p>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontFamily: 'monospace', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333', color: '#888' }}>
              <th style={{ padding: '0.75rem' }}>Foreground</th>
              <th style={{ padding: '0.75rem' }}>Background</th>
              <th style={{ padding: '0.75rem' }}>UI Element</th>
              <th style={{ padding: '0.75rem' }}>Measured Ratio</th>
              <th style={{ padding: '0.75rem' }}>Standard</th>
              <th style={{ padding: '0.75rem' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #222' }}>
                <td style={{ padding: '0.75rem', color: '#FFF' }}>{r.fg}</td>
                <td style={{ padding: '0.75rem', color: '#FFF' }}>{r.bg}</td>
                <td style={{ padding: '0.75rem', color: '#CCC' }}>{r.elem}</td>
                <td style={{ padding: '0.75rem', color: 'var(--vb-lime)', fontWeight: 800 }}>{r.ratio}</td>
                <td style={{ padding: '0.75rem', color: '#888' }}>{r.standard}</td>
                <td style={{ padding: '0.75rem', color: 'var(--vb-lime)', fontWeight: 900 }}>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
