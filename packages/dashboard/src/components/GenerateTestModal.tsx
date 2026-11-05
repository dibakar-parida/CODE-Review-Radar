import React, { useState } from 'react';
import { ReviewFinding } from '@cr/shared';

export interface GeneratedTestData {
  testFilePath: string;
  testCode: string;
  isNewFile?: boolean;
}

interface GenerateTestModalProps {
  finding: ReviewFinding;
  data: GeneratedTestData | null;
  isLoading: boolean;
  onClose: () => void;
}

export const GenerateTestModal: React.FC<GenerateTestModalProps> = ({
  finding,
  data,
  isLoading,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (data?.testCode) {
      navigator.clipboard.writeText(data.testCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="generate-test-title"
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
          border: '2px solid var(--vb-amber)',
          borderRadius: '1rem',
          maxWidth: '800px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '2rem',
          color: '#FFF',
          boxShadow: '0 0 30px rgba(255, 191, 0, 0.2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span className="badge" style={{ background: 'var(--vb-amber)', color: '#000' }}>
                {finding.id}
              </span>
              <span style={{ color: 'var(--vb-amber)', fontWeight: 700, fontFamily: 'monospace' }}>
                SYNTHESIZED UNIT TEST FIXTURE
              </span>
            </div>
            <h2 id="generate-test-title" style={{ fontSize: '1.4rem', margin: 0, color: '#FFF' }}>
              Regression Test for: {finding.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close test generator dialog"
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
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--vb-amber)', fontFamily: 'monospace' }}>
            <span>🧪 Synthesizing Vitest Regression Suite via @cr/core TestGenerator...</span>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '1rem' }}>
              <span style={{ color: '#888', fontSize: '0.85rem' }}>Target Destination: </span>
              <span style={{ fontFamily: 'monospace', color: 'var(--vb-cyan)', fontWeight: 700 }}>
                {data?.testFilePath || `${finding.filePath}.test.ts`}
              </span>
            </div>

            <pre
              style={{
                backgroundColor: '#0A0A0A',
                border: '1px solid #333',
                padding: '1.25rem',
                borderRadius: '0.5rem',
                overflowX: 'auto',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                color: 'var(--vb-lime)',
                lineHeight: 1.4,
                marginBottom: '1.5rem',
              }}
            >
              {data?.testCode || finding.suggestedTest || '// Generating test...'}
            </pre>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={handleCopy}
                style={{
                  background: copied ? 'var(--vb-lime)' : '#222',
                  color: copied ? '#000' : '#FFF',
                  border: '1px solid #444',
                  padding: '0.6rem 1.4rem',
                  borderRadius: '0.5rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {copied ? '✔ Copied to Clipboard' : '📋 Copy Test Suite'}
              </button>

              <button
                onClick={onClose}
                className="button"
                style={{ padding: '0.6rem 1.6rem' }}
              >
                <span>Done</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
