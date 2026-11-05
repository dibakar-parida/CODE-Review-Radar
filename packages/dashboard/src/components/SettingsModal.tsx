import React, { useState, useEffect } from 'react';

export interface ProviderOption {
  id: string;
  name: string;
  defaultModel: string;
  defaultEndpoint?: string;
}

interface SettingsModalProps {
  onClose: () => void;
  onSave?: (settings: { provider: string; model: string }) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, onSave }) => {
  const [providers, setProviders] = useState<ProviderOption[]>([
    { id: 'ollama', name: 'Ollama (Local-First)', defaultModel: 'qwen2.5-coder:7b', defaultEndpoint: 'http://127.0.0.1:11434' },
    { id: 'gemini', name: 'Google Gemini', defaultModel: 'gemini-flash-latest', defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta' },
    { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-4o', defaultEndpoint: 'https://api.openai.com/v1' },
    { id: 'anthropic', name: 'Anthropic Claude', defaultModel: 'claude-3-5-sonnet-20241022', defaultEndpoint: 'https://api.anthropic.com/v1' },
    { id: 'custom', name: 'Custom OpenAI-Compatible (Groq / DeepSeek / Mistral)', defaultModel: 'deepseek-coder', defaultEndpoint: 'https://api.deepseek.com/v1' },
  ]);
  const [selectedProvider, setSelectedProvider] = useState<string>('gemini');
  const [modelName, setModelName] = useState<string>('gemini-flash-latest');
  const [apiKey, setApiKey] = useState<string>('');
  const [endpoint, setEndpoint] = useState<string>('https://generativelanguage.googleapis.com/v1beta');
  const [testStatus, setTestStatus] = useState<string>('');
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    fetch('http://127.0.0.1:3100/api/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          if (data.availableProviders) {
            setProviders(data.availableProviders);
          }
          if (data.activeProvider) {
            setSelectedProvider(data.activeProvider);
          }
          if (data.activeModel) {
            setModelName(data.activeModel);
          }
        }
      })
      .catch(() => {
        // use default state
      });
  }, []);

  const handleProviderChange = (id: string) => {
    setSelectedProvider(id);
    const p = providers.find((item) => item.id === id);
    if (p) {
      setModelName(p.defaultModel);
      if (p.defaultEndpoint) {
        setEndpoint(p.defaultEndpoint);
      }
    }
    setTestStatus('');
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestStatus('Testing endpoint connectivity...');
    try {
      if (selectedProvider === 'gemini') {
        if (!apiKey) {
          setTestStatus('✖ Google Gemini API key required to test connection.');
          setIsTesting(false);
          return;
        }

        const url = `${endpoint.replace(/\/+$/, '')}/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Explain how AI works in a few words' }] }],
          }),
        });

        if (res.ok) {
          setTestStatus(`✔ Google Gemini (${modelName}) connected and validated!`);
        } else {
          const errText = await res.text().catch(() => '');
          setTestStatus(`✖ Gemini API error [${res.status}]: ${errText || res.statusText}`);
        }
      } else if (selectedProvider === 'ollama') {
        const res = await fetch(`${endpoint}/api/tags`).catch(() => null);
        if (res && res.ok) {
          setTestStatus('✔ Connected to Ollama local instance successfully!');
        } else {
          setTestStatus('✖ Ollama connection failed. Ensure `ollama serve` is running.');
        }
      } else {
        if (!apiKey && selectedProvider !== 'custom') {
          setTestStatus('✖ API key required for provider test.');
        } else {
          setTestStatus(`✔ Provider [${selectedProvider.toUpperCase()}] parameters configured.`);
        }
      }
    } catch (err: unknown) {
      setTestStatus(`✖ Connection test failed: ${(err as Error).message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setTestStatus('Persisting settings to .env and updating active review engine...');
    try {
      const res = await fetch('http://127.0.0.1:3100/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          model: modelName,
          endpoint,
          apiKey,
        }),
      });

      if (res.ok) {
        onSave?.({ provider: selectedProvider, model: modelName });
        onClose();
      } else {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        setTestStatus(`✖ Failed to save settings: ${errJson.error || 'Server error'}`);
      }
    } catch (err: unknown) {
      setTestStatus(`✖ Failed to reach server: ${(err as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
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
          border: '2px solid var(--vb-lime)',
          borderRadius: '1rem',
          maxWidth: '650px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '2rem',
          color: '#FFF',
          boxShadow: '0 0 30px rgba(57, 255, 20, 0.2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <h2 id="settings-modal-title" style={{ fontSize: '1.4rem', margin: 0, color: '#FFF' }}>
              ⚙ System & Provider Settings
            </h2>
            <p style={{ margin: '0.2rem 0 0 0', color: '#888', fontSize: '0.85rem' }}>
              Configure active AI review engines and local endpoint connections.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings dialog"
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

        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', color: 'var(--vb-lime)', fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            ACTIVE REVIEW PROVIDER
          </label>
          <select
            value={selectedProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#0D0D0D',
              border: '1px solid #333',
              borderRadius: '0.5rem',
              color: '#FFF',
              fontWeight: 600,
            }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', color: '#AAA', fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            MODEL IDENTIFIER
          </label>
          <input
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#0D0D0D',
              border: '1px solid #333',
              borderRadius: '0.5rem',
              color: '#FFF',
              fontFamily: 'monospace',
            }}
          />
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', color: '#AAA', fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            ENDPOINT / BASE URL
          </label>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#0D0D0D',
              border: '1px solid #333',
              borderRadius: '0.5rem',
              color: '#FFF',
              fontFamily: 'monospace',
            }}
          />
        </div>

        {selectedProvider !== 'ollama' && (
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', color: '#AAA', fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem' }}>
              API KEY
            </label>
            <input
              type="password"
              placeholder="Paste provider API key..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: '#0D0D0D',
                border: '1px solid #333',
                borderRadius: '0.5rem',
                color: '#FFF',
                fontFamily: 'monospace',
              }}
            />
          </div>
        )}

        {testStatus && (
          <div
            style={{
              padding: '0.75rem',
              borderRadius: '0.5rem',
              background: '#0A0A0A',
              border: '1px solid #333',
              color: testStatus.startsWith('✔') ? 'var(--vb-lime)' : 'var(--vb-rose)',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              marginBottom: '1.5rem',
            }}
          >
            {testStatus}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem' }}>
          <button
            onClick={handleTestConnection}
            disabled={isTesting}
            style={{
              background: '#222',
              color: 'var(--vb-cyan)',
              border: '1px solid var(--vb-cyan)',
              padding: '0.6rem 1.25rem',
              borderRadius: '0.5rem',
              fontWeight: 700,
              cursor: isTesting ? 'wait' : 'pointer',
            }}
          >
            {isTesting ? 'Testing...' : '⚡ Test Connection'}
          </button>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className="button"
            style={{ padding: '0.6rem 1.6rem', cursor: isSaving ? 'wait' : 'pointer' }}
          >
            <span>{isSaving ? 'Saving...' : 'Save & Close'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
