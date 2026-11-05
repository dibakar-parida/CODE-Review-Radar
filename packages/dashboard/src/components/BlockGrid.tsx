import React from 'react';
import { ReviewSummary } from '@cr/shared';

interface BlockGridProps {
  summary: ReviewSummary;
  onFilterSeverity?: (severity: string) => void;
}

export const BlockGrid: React.FC<BlockGridProps> = ({ summary, onFilterSeverity }) => {
  return (
    <div className="grid" style={{ marginBottom: '4rem' }}>
      {/* Block 1: Lime */}
      <div
        className="block"
        tabIndex={0}
        role="button"
        aria-label={`${summary.bySeverity.critical ?? 0} Critical findings`}
        onClick={() => onFilterSeverity?.('critical')}
      >
        <div style={{ fontSize: '1.75rem', position: 'absolute', top: '1.25rem', right: '1.25rem' }}>⚠️</div>
        <div style={{ fontSize: '3.5rem', lineHeight: 1 }}>{summary.bySeverity.critical ?? 0}</div>
        <div style={{ fontSize: '0.9rem', letterSpacing: '0.05em', marginTop: '0.5rem', textTransform: 'uppercase' }}>
          CRITICAL / HALTING
        </div>
      </div>

      {/* Block 2: Purple */}
      <div
        className="block"
        tabIndex={0}
        role="button"
        aria-label={`${summary.bySeverity.major ?? 0} Major findings`}
        onClick={() => onFilterSeverity?.('major')}
      >
        <div style={{ fontSize: '1.75rem', position: 'absolute', top: '1.25rem', right: '1.25rem' }}>⚡</div>
        <div style={{ fontSize: '3.5rem', lineHeight: 1 }}>{summary.bySeverity.major ?? 0}</div>
        <div style={{ fontSize: '0.9rem', letterSpacing: '0.05em', marginTop: '0.5rem', textTransform: 'uppercase' }}>
          MAJOR REFACTORS
        </div>
      </div>

      {/* Block 3: Pink */}
      <div
        className="block"
        tabIndex={0}
        role="button"
        aria-label={`${summary.bySeverity.minor ?? 0} Minor findings`}
        onClick={() => onFilterSeverity?.('minor')}
      >
        <div style={{ fontSize: '1.75rem', position: 'absolute', top: '1.25rem', right: '1.25rem' }}>🔧</div>
        <div style={{ fontSize: '3.5rem', lineHeight: 1 }}>{summary.bySeverity.minor ?? 0}</div>
        <div style={{ fontSize: '0.9rem', letterSpacing: '0.05em', marginTop: '0.5rem', textTransform: 'uppercase' }}>
          MINOR / SMELLS
        </div>
      </div>

      {/* Block 4: Cyan */}
      <div
        className="block"
        tabIndex={0}
        role="button"
        aria-label={`Fix confidence score 96 percent`}
      >
        <div style={{ fontSize: '1.75rem', position: 'absolute', top: '1.25rem', right: '1.25rem' }}>✨</div>
        <div style={{ fontSize: '3.5rem', lineHeight: 1 }}>96%</div>
        <div style={{ fontSize: '0.9rem', letterSpacing: '0.05em', marginTop: '0.5rem', textTransform: 'uppercase' }}>
          FIX CONFIDENCE
        </div>
      </div>
    </div>
  );
};
