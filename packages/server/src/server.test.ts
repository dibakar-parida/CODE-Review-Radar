import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { WebSocket } from 'ws';
import { LocalReviewServer } from './server.js';
import { MockLLMProvider, UnifiedReviewOrchestrator } from '@cr/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('LocalReviewServer (@cr/server) on 127.0.0.1', () => {
  let server: LocalReviewServer;
  let tempDir: string;
  const testPort = 3199;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-server-test-'));

    // Initialize fixture git repo
    await execFileAsync('git', ['init'], { cwd: tempDir });
    await execFileAsync('git', ['config', 'user.name', 'Tester'], { cwd: tempDir });
    await execFileAsync('git', ['config', 'user.email', 'tester@local.test'], { cwd: tempDir });

    const file = path.join(tempDir, 'demo.ts');
    await fs.writeFile(file, 'export function compute() { return 1; }\n', 'utf-8');
    await execFileAsync('git', ['add', '.'], { cwd: tempDir });
    await execFileAsync('git', ['commit', '-m', 'Init'], { cwd: tempDir });

    // Mutate file
    await fs.writeFile(file, 'export function compute() { return 2; }\n', 'utf-8');

    const mockProvider = new MockLLMProvider([]);
    const orchestrator = new UnifiedReviewOrchestrator({
      cwd: tempDir,
      provider: mockProvider,
    });

    server = new LocalReviewServer({
      port: testPort,
      host: '127.0.0.1',
      repoRoot: tempDir,
      orchestrator,
    });

    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('GET /api/health responds with local-only status', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/health`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as { status: string; host: string; mode: string };
    expect(data.status).toBe('ok');
    expect(data.host).toBe('127.0.0.1');
    expect(data.mode).toBe('local');
  });

  it('POST /api/review executes review and broadcasts progress via WebSocket', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/events/progress`);
    const messages: any[] = [];

    await new Promise<void>((resolve) => {
      ws.on('open', () => resolve());
      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
      });
    });

    const res = await fetch(`http://127.0.0.1:${testPort}/api/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: { type: 'unstaged' } }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { summary: any; findings: any[] };
    expect(data.summary).toBeDefined();

    ws.close();
    expect(messages.some((m) => m.type === 'connected')).toBe(true);
  });

  it('records decisions and exposes acceptance telemetry via /api/telemetry', async () => {
    const finding = {
      id: 'SEC-101',
      category: 'security',
      severity: 'critical',
      confidence: 0.99,
      filePath: 'demo.ts',
      startLine: 1,
      endLine: 1,
      title: 'Eval execution',
      explanation: 'Dangerous eval',
      evidence: 'eval(x)',
    };

    // 1. Record accepted decision
    const postRes1 = await fetch(`http://127.0.0.1:${testPort}/api/telemetry/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        finding,
        decision: 'accepted',
        reason: 'Applied fix in IDE',
      }),
    });
    expect(postRes1.status).toBe(200);

    // 2. Record ignored decision for another finding
    const postRes2 = await fetch(`http://127.0.0.1:${testPort}/api/telemetry/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        finding: { ...finding, id: 'PERF-102', category: 'performance' },
        decision: 'ignored',
        reason: 'False positive',
      }),
    });
    expect(postRes2.status).toBe(200);

    // 3. Query telemetry stats
    const statsRes = await fetch(`http://127.0.0.1:${testPort}/api/telemetry/stats`);
    expect(statsRes.status).toBe(200);
    const data = (await statsRes.json()) as { stats: Record<string, any> };

    expect(data.stats.security).toBeDefined();
    expect(data.stats.security.accepted).toBe(1);
    expect(data.stats.security.acceptanceRate).toBe(1.0);

    expect(data.stats.performance).toBeDefined();
    expect(data.stats.performance.ignored).toBe(1);
    expect(data.stats.performance.acceptanceRate).toBe(0.0);
  });

  it('rejects requests with malicious Host headers to prevent DNS Rebinding', async () => {
    // Note: WHATWG fetch silently strips custom 'Host' headers, so we use http.get
    const statusCode = await new Promise<number>((resolve) => {
      const req = http.get(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path: '/api/health',
          headers: {
            Host: 'attacker.evil-domain.com',
          },
        },
        (res) => {
          resolve(res.statusCode ?? 0);
        }
      );
      req.on('error', () => resolve(0));
    });

    expect(statusCode).toBe(403);
  });

  it('rejects mutating requests with external Origin to prevent CSRF attacks', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://malicious-website.com',
      },
      body: JSON.stringify({ target: { type: 'staged' } }),
    });
    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain('CSRF Protection');
  });

  it('enforces authentication token verification when configured', async () => {
    const authPort = 3198;
    const authServer = new LocalReviewServer({
      port: authPort,
      host: '127.0.0.1',
      repoRoot: tempDir,
      authToken: 'secret-token-123',
    });
    await authServer.start();

    try {
      // 1. Missing token -> 401
      const resUnauth = await fetch(`http://127.0.0.1:${authPort}/api/settings`);
      expect(resUnauth.status).toBe(401);

      // 2. Invalid token -> 401
      const resBad = await fetch(`http://127.0.0.1:${authPort}/api/settings`, {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      expect(resBad.status).toBe(401);

      // 3. Valid token in Authorization header -> 200
      const resAuth = await fetch(`http://127.0.0.1:${authPort}/api/settings`, {
        headers: { Authorization: 'Bearer secret-token-123' },
      });
      expect(resAuth.status).toBe(200);

      // 4. Valid token in query param -> 200
      const resQuery = await fetch(`http://127.0.0.1:${authPort}/api/settings?token=secret-token-123`);
      expect(resQuery.status).toBe(200);

      // 5. Auth verify endpoint
      const loginRes = await fetch(`http://127.0.0.1:${authPort}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'secret-token-123' }),
      });
      expect(loginRes.status).toBe(200);
      const loginData = (await loginRes.json()) as { success: boolean };
      expect(loginData.success).toBe(true);
    } finally {
      await authServer.stop();
    }
  });

  it('POST /api/explain generates context explanation for finding', async () => {
    const finding = {
      id: 'SEC-200',
      category: 'security',
      severity: 'critical',
      confidence: 0.95,
      filePath: 'demo.ts',
      startLine: 1,
      endLine: 1,
      title: 'Insecure Function Export',
      explanation: 'Function compute exposes internal state',
      evidence: 'export function compute()',
    };

    const res = await fetch(`http://127.0.0.1:${testPort}/api/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ finding }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { findingId: string; snippet: string; explanation: string };
    expect(data.findingId).toBe('SEC-200');
    expect(data.snippet).toContain('export function compute()');
  });

  it('POST /api/generate-test synthesizes targeted unit test fixture', async () => {
    const finding = {
      id: 'BUG-300',
      category: 'bug',
      severity: 'major',
      confidence: 0.9,
      filePath: 'demo.ts',
      startLine: 1,
      endLine: 1,
      title: 'Off by one error',
      explanation: 'Array index out of bounds',
      suggestedTest: `it('tests array bounds', () => { expect(true).toBe(true); });`,
    };

    const res = await fetch(`http://127.0.0.1:${testPort}/api/generate-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ finding }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { testFilePath: string; testCode: string };
    expect(data.testFilePath).toBe('demo.test.ts');
    expect(data.testCode).toContain('tests array bounds');
  });

  it('GET /api/hotspots returns git commit churn metrics', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/hotspots`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { hotspots: any[] };
    expect(Array.isArray(data.hotspots)).toBe(true);
  });

  it('GET /api/settings returns platform settings and available providers', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/settings`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { availableProviders: any[]; authRequired: boolean };
    expect(data.availableProviders.some((p) => p.id === 'gemini')).toBe(true);
    expect(data.availableProviders.some((p) => p.id === 'custom')).toBe(true);
  });

  it('POST /api/settings persists provider updates to .env and applies to active engine', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'gemini',
        model: 'gemini-flash-latest',
        apiKey: 'AQ.TestApiKey12345',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta',
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { success: boolean; activeProvider: string; activeModel: string };
    expect(data.success).toBe(true);
    expect(data.activeProvider).toBe('gemini');
    expect(data.activeModel).toBe('gemini-flash-latest');

    // Verify .env file was created/updated in tempDir
    const envContent = await fs.readFile(path.join(tempDir, '.env'), 'utf-8');
    expect(envContent).toContain('CR_PROVIDER=gemini');
    expect(envContent).toContain('GEMINI_MODEL=gemini-flash-latest');
    expect(envContent).toContain('GEMINI_API_KEY=AQ.TestApiKey12345');

    // Verify GET /api/settings reflects the updated active provider and model
    const getRes = await fetch(`http://127.0.0.1:${testPort}/api/settings`);
    const getData = (await getRes.json()) as { activeProvider: string; activeModel: string; hasApiKey: boolean };
    expect(getData.activeProvider).toBe('gemini');
    expect(getData.activeModel).toBe('gemini-flash-latest');
    expect(getData.hasApiKey).toBe(true);
  });
});
