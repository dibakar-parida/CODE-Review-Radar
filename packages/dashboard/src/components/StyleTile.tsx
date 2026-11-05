import React from 'react';

export const StyleTile: React.FC = () => {
  const swatches = [
    { name: '--vb-lime', hex: '#39FF14', textDark: true },
    { name: '--vb-purple', hex: '#BF00FF', textDark: false },
    { name: '--vb-pink', hex: '#FF1493', textDark: true },
    { name: '--vb-cyan', hex: '#00FFFF', textDark: true },
    { name: '--vb-amber', hex: '#FFAA00', textDark: true },
    { name: '--vb-orange', hex: '#FF7F00', textDark: true },
    { name: '--vb-rose', hex: '#FF006E', textDark: false },
    { name: '--vb-chartreuse', hex: '#CCFF00', textDark: true },
  ];

  return (
    <section
      style={{
        background: '#141414',
        border: '2px solid #262626',
        borderRadius: '1.5rem',
        padding: '2.5rem',
        marginBottom: '3rem',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ marginBottom: '1.5rem' }}>
        <span
          style={{
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            color: 'var(--vb-purple)',
            fontWeight: 900,
            textTransform: 'uppercase',
          }}
        >
          Frame 1 Specification
        </span>
        <h2 style={{ color: '#FFF', margin: '0.5rem 0' }}>Style Tile & Component Sheet</h2>
      </div>

      {/* Swatches Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {swatches.map((s) => (
          <div
            key={s.name}
            style={{
              background: s.hex,
              color: s.textDark ? '#000' : '#FFF',
              padding: '1rem',
              borderRadius: '1rem',
              height: '90px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              fontWeight: 900,
              fontFamily: 'monospace',
              fontSize: '0.8rem',
            }}
          >
            <span>{s.name}</span>
            <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>{s.hex}</span>
          </div>
        ))}
      </div>

      {/* Controls & Focus Rings */}
      <div>
        <h4 style={{ color: '#888', textTransform: 'uppercase', fontSize: '0.8rem', letterSpacing: '0.05em', marginBottom: '1rem' }}>
          Gradient CTAs & Accessible Focus Rings
        </h4>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="button" aria-label="Sample gradient primary action">
            Gradient CTA
          </button>
          <button
            style={{
              background: '#000',
              border: '2px solid var(--vb-cyan)',
              color: 'var(--vb-cyan)',
              fontWeight: 800,
              padding: '0.8rem 1.6rem',
              borderRadius: '1rem',
              cursor: 'pointer',
            }}
            aria-label="Sample secondary action"
          >
            Secondary Action
          </button>
          <button
            style={{
              background: '#000',
              border: '1px solid #444',
              color: '#FFF',
              borderRadius: '0.75rem',
              padding: '0.75rem',
              cursor: 'pointer',
            }}
            aria-label="Refresh review results"
          >
            🔄
          </button>
        </div>
      </div>
    </section>
  );
};
