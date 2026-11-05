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
});
