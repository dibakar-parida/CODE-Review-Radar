import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { ReviewTarget, ReviewTargetSchema, ReviewFinding } from '@cr/shared';
import {
  UnifiedReviewOrchestrator,
  AtomicTransactionManager,
  RepositoryIndexer,
  WebhookEmulator,
  MultiRepoKnowledgeBase,
  PolicyQueryEngine,
  GitChurnAnalyzer,
  generateUnitTestForFinding,
  createLLMProvider,
  loadEnv,
  saveEnv,
} from '@cr/core';
import { SwarmReviewWatcher } from './watcher.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  repoRoot?: string;
  orchestrator?: UnifiedReviewOrchestrator;
  indexer?: RepositoryIndexer;
  authToken?: string;
  requireAuth?: boolean;
}

export class LocalReviewServer {
  public readonly app: express.Express;
  public readonly server: http.Server;
  public readonly wss: WebSocketServer;
  public readonly host: string;
  public readonly port: number;
  public readonly authToken?: string;

  private readonly repoRoot: string;
  private readonly orchestrator: UnifiedReviewOrchestrator;
  private readonly indexer: RepositoryIndexer;
  private watcher?: SwarmReviewWatcher;

  constructor(options: ServerOptions = {}) {
    // Strictly bind to 127.0.0.1 by default for Clean-Room isolation
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 3100;
    this.repoRoot = options.repoRoot ?? process.cwd();
    loadEnv(this.repoRoot);
    this.authToken =
      options.authToken ??
      (options.requireAuth ? crypto.randomBytes(24).toString('hex') : process.env['CR_AUTH_TOKEN']);

    this.orchestrator =
      options.orchestrator ??
      new UnifiedReviewOrchestrator({ cwd: this.repoRoot });
    this.indexer =
      options.indexer ?? new RepositoryIndexer({ repoRoot: this.repoRoot });

    this.app = express();
    this.app.use(cors({ origin: /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/ }));
    this.app.use(express.json());

    // 1. DNS Rebinding Protection Middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const hostHeader = req.headers.host || '';
      const hostname = hostHeader.split(':')[0]?.toLowerCase() || '';
      const allowedHosts = ['127.0.0.1', 'localhost', '::1', '[::1]', this.host.toLowerCase()];
      if (hostname && !allowedHosts.includes(hostname)) {
        res.status(403).json({ error: 'DNS Rebinding Protection: Forbidden Host header' });
        return;
      }
      next();
    });

    // 2. CSRF / Origin Validation for State-Mutating Requests
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        const origin = req.headers.origin;
        if (origin) {
          try {
            const url = new URL(origin);
            const originHost = url.hostname.toLowerCase();
            const allowed = ['127.0.0.1', 'localhost', '::1', '[::1]', this.host.toLowerCase()];
            if (!allowed.includes(originHost)) {
              res.status(403).json({ error: 'CSRF Protection: Forbidden Origin header' });
              return;
            }
          } catch {
            res.status(403).json({ error: 'CSRF Protection: Invalid Origin header' });
            return;
          }
        }
      }
      next();
    });

    // 3. Local Authentication Middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path === '/api/health' || req.path === '/api/auth/login') {
        return next();
      }
      if (!this.authToken) {
        return next();
      }

      const authHeader = req.headers.authorization;
      const customToken = req.headers['x-cr-token'];
      const queryToken = req.query['token'];

      const token =
        (authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined) ??
        (typeof customToken === 'string' ? customToken.trim() : undefined) ??
        (typeof queryToken === 'string' ? queryToken.trim() : undefined);

      if (token !== this.authToken) {
        res.status(401).json({ error: 'Unauthorized: Invalid or missing authentication token' });
        return;
      }
      next();
    });

    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: '/events/progress' });

    this.initWebSocket();
    this.initRoutes();
  }

  private initWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      if (this.authToken) {
        try {
          const url = new URL(req.url ?? '/', `http://${this.host}:${this.port}`);
          const queryToken = url.searchParams.get('token');
          const headerToken = req.headers['x-cr-token'];
          if (queryToken !== this.authToken && headerToken !== this.authToken) {
            ws.close(1008, 'Unauthorized');
            return;
          }
        } catch {
          ws.close(1008, 'Unauthorized');
          return;
        }
      }

      ws.send(
        JSON.stringify({
          type: 'connected',
          timestamp: new Date().toISOString(),
          message: 'Connected to @cr/server live progress stream on 127.0.0.1',
        })
      );
    });
  }

  public broadcast(event: { type: string; stage?: string; detail?: string; payload?: unknown }): void {
    const message = JSON.stringify({
      ...event,
      timestamp: new Date().toISOString(),
    });

    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  private initRoutes(): void {
    // 1. Health & Mode Check
    this.app.get('/api/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        service: 'cr-server',
        host: this.host,
        port: this.port,
        mode: 'local',
        uptimeSeconds: Math.floor(process.uptime()),
      });
    });

    // 2. Trigger Review
    this.app.post('/api/review', async (req: Request, res: Response) => {
      try {
        const rawTarget = req.body?.target ?? { type: 'staged' };
        const target: ReviewTarget = ReviewTargetSchema.parse(rawTarget);

        this.broadcast({
          type: 'progress',
          stage: 'git',
          detail: `Extracting ${target.type} Git hunks...`,
        });

        this.broadcast({
          type: 'progress',
          stage: 'analysis',
          detail: 'Executing parallel multi-agent analysis and AST guard...',
        });

        const result = await this.orchestrator.runReview(target);

        this.broadcast({
          type: 'progress',
          stage: 'completed',
          detail: `Review finished with ${result.summary.totalFindings} finding(s).`,
          payload: result.summary,
        });

        res.json(result);
      } catch (err: unknown) {
        const error = err as Error;
        this.broadcast({
          type: 'error',
          stage: 'failed',
          detail: error.message,
        });
        res.status(500).json({ error: error.message });
      }
    });

    // 3. Approval-Gated Auto Fix
    this.app.post('/api/fix', async (req: Request, res: Response) => {
      try {
        const { filePath, patch, verify = true } = req.body as {
          filePath: string;
          patch: string;
          verify?: boolean;
        };

        if (!filePath || !patch) {
          res.status(400).json({ error: 'filePath and patch are required' });
          return;
        }

        this.broadcast({
          type: 'progress',
          stage: 'fix:snapshot',
          detail: `Creating snapshot backup for ${filePath}...`,
        });

        const tx = new AtomicTransactionManager(this.repoRoot);
        await tx.applyPatchToFile(filePath, patch);

        if (verify) {
          this.broadcast({
            type: 'progress',
            stage: 'fix:verify',
            detail: 'Running post-patch typecheck verification...',
          });

          const verifyResult = await tx.verifyAndCommit({ runTypecheck: true });
          if (!verifyResult.success) {
            this.broadcast({
              type: 'fix:rolled_back',
              detail: verifyResult.error,
            });
            res.status(422).json({
              success: false,
              rolledBack: true,
              error: verifyResult.error,
            });
            return;
          }
        } else {
          await tx.verifyAndCommit();
        }

        this.broadcast({
          type: 'fix:committed',
          detail: `Successfully patched and verified ${filePath}`,
        });

        res.json({ success: true, committed: true });
      } catch (err: unknown) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // 4. Index Repository
    this.app.post('/api/index', async (_req: Request, res: Response) => {
      try {
        this.broadcast({
          type: 'progress',
          stage: 'indexing:start',
          detail: 'Scanning AST symbols and call graph...',
        });

        const stats = await this.indexer.indexRepository();

        this.broadcast({
          type: 'progress',
          stage: 'indexing:done',
          detail: `Indexed ${stats.indexedFiles} files (${stats.skippedFiles} up-to-date) in ${stats.durationMs}ms`,
          payload: stats,
        });

        res.json(stats);
      } catch (err: unknown) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // 5. Telemetry & Decision Tracking
    this.app.post('/api/telemetry/decision', async (req: Request, res: Response) => {
      try {
        const { finding, decision, reason } = req.body as {
          finding: ReviewFinding;
          decision: 'accepted' | 'ignored';
          reason?: string;
        };

        if (!finding || !decision) {
          res.status(400).json({ error: 'finding and decision ("accepted" | "ignored") are required' });
          return;
        }

        this.orchestrator.getReviewMemory().recordDecision(finding, decision, reason);

        this.broadcast({
          type: 'telemetry:recorded',
          stage: 'telemetry',
          detail: `Decision recorded for ${finding.id} [${finding.category}]: ${decision}`,
          payload: { findingId: finding.id, category: finding.category, decision, reason },
        });

        res.json({ success: true, recorded: decision });
      } catch (err: unknown) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    this.app.get('/api/telemetry/stats', async (_req: Request, res: Response) => {
      try {
        const stats = this.orchestrator.getReviewMemory().getTelemetryStats();
        res.json({
          stats,
          timestamp: new Date().toISOString(),
        });
      } catch (err: unknown) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // 6. Local CI/CD Webhook Emulation (GitHub & GitLab)
    this.app.post('/api/webhook/github', async (req: Request, res: Response) => {
      try {
        const event = WebhookEmulator.parsePayload(req.body, req.headers as Record<string, string | undefined>);
        this.broadcast({
          type: 'webhook:received',
          stage: 'webhook',
          detail: `GitHub webhook event "${event.event}" for ${event.repoName}:${event.branch}`,
          payload: event,
        });

        const result = await this.orchestrator.runReview({
          type: 'branch',
          ref: event.branch,
          baseRef: event.baseBranch,
        });

        const checkRun = WebhookEmulator.formatCheckRun(event, result);
        this.broadcast({
          type: 'webhook:completed',
          stage: 'webhook',
          detail: `Review check concluded with status: ${checkRun.conclusion.toUpperCase()}`,
          payload: checkRun,
        });

        res.json(checkRun);
      } catch (err: unknown) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    this.app.post('/api/webhook/gitlab', async (req: Request, res: Response) => {
      try {
        const event = WebhookEmulator.parsePayload(req.body, req.headers as Record<string, string | undefined>);
        this.broadcast({
          type: 'webhook:received',
          stage: 'webhook',
          detail: `GitLab webhook event "${event.event}" for ${event.repoName}:${event.branch}`,
          payload: event,
        });

        const result = await this.orchestrator.runReview({
          type: 'branch',
          ref: event.branch,
          baseRef: event.baseBranch,
        });

        const checkRun = WebhookEmulator.formatCheckRun(event, result);
        res.json(checkRun);
      } catch (err: unknown) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // 7. Continuous IDE Agent Swarm Watcher Control
    this.app.post('/api/swarm/watch', (req: Request, res: Response) => {
      const { action } = req.body as { action?: 'start' | 'stop' | 'status' };
      if (action === 'start') {
        if (!this.watcher) {
          this.watcher = new SwarmReviewWatcher({
            repoRoot: this.repoRoot,
            orchestrator: this.orchestrator,
            broadcast: (e) => this.broadcast(e),
          });
        }
        this.watcher.start();
        res.json({ active: true, message: 'Continuous IDE swarm file watcher started' });
      } else if (action === 'stop') {
        this.watcher?.stop();
        res.json({ active: false, message: 'Continuous IDE swarm file watcher stopped' });
      } else {
        res.json({ active: this.watcher?.isActive() ?? false });
      }
    });

    // 8. Natural Language Policy Query API
    this.app.post('/api/ask', async (req: Request, res: Response) => {
      try {
        const { query, repoId, limit } = req.body as { query: string; repoId?: string; limit?: number };
        if (!query) {
          res.status(400).json({ error: 'query parameter is required' });
          return;
        }

        const kb = new MultiRepoKnowledgeBase({ storage: this.indexer.getStorage() });
        const engine = new PolicyQueryEngine({ knowledgeBase: kb });
        const result = await engine.ask(query, { repoId, limit });
        res.json(result);
      } catch (err: unknown) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // 9. Single-User Authentication Verification Endpoint
    this.app.post('/api/auth/login', (req: Request, res: Response) => {
      const { token } = req.body as { token?: string };
      if (!this.authToken) {
        res.json({ success: true, authRequired: false });
        return;
      }
      if (token === this.authToken) {
        res.json({ success: true, token: this.authToken });
      } else {
        res.status(401).json({ success: false, error: 'Invalid authentication token' });
      }
    });

    // 10. Explain Context for Finding
    this.app.post('/api/explain', async (req: Request, res: Response) => {
      try {
        const { finding } = req.body as { finding: ReviewFinding };
        if (!finding) {
          res.status(400).json({ error: 'finding object is required' });
          return;
        }

        let snippet = finding.evidence || '';
        try {
          const fullPath = path.resolve(this.repoRoot, finding.filePath);
          const content = await fs.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          const start = Math.max(0, finding.startLine - 4);
          const end = Math.min(lines.length, finding.endLine + 4);
          snippet = lines.slice(start, end).join('\n');
        } catch {
          // Fallback to evidence if file cannot be read
        }

        res.json({
          findingId: finding.id,
          title: finding.title,
          explanation: finding.explanation,
          snippet,
          blastRadius: finding.blastRadius ?? [],
          suggestedPatch: finding.suggestedPatch,
          category: finding.category,
          severity: finding.severity,
          impactAnalysis: `Severity [${finding.severity.toUpperCase()}] defect detected in ${finding.filePath} (lines ${finding.startLine}-${finding.endLine}).`,
        });
      } catch (err: unknown) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // 11. Generate Targeted Unit Test for Finding
    this.app.post('/api/generate-test', async (req: Request, res: Response) => {
      try {
        const { finding } = req.body as { finding: ReviewFinding };
        if (!finding) {
          res.status(400).json({ error: 'finding object is required' });
          return;
        }

        const testUnit = generateUnitTestForFinding(finding);
        res.json(testUnit);
      } catch (err: unknown) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // 12. Git Commit Churn & Hotspot Analysis
    this.app.get('/api/hotspots', async (_req: Request, res: Response) => {
      try {
        const analyzer = new GitChurnAnalyzer({ cwd: this.repoRoot });
        const hotspots = await analyzer.analyzeChurn();
        res.json({
          hotspots,
          timestamp: new Date().toISOString(),
        });
      } catch (err: unknown) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // 13. System & Provider Settings (Persistent via .env)
    this.app.get('/api/settings', async (_req: Request, res: Response) => {
      loadEnv(this.repoRoot);
      const activeProvider =
        process.env['CR_PROVIDER'] || (process.env['GEMINI_API_KEY'] ? 'gemini' : 'ollama');
      const activeModel =
        activeProvider === 'gemini'
          ? (process.env['GEMINI_MODEL'] || 'gemini-flash-latest')
          : activeProvider === 'openai'
          ? (process.env['OPENAI_MODEL'] || 'gpt-4o')
          : activeProvider === 'anthropic'
          ? (process.env['ANTHROPIC_MODEL'] || 'claude-3-5-sonnet-20241022')
          : activeProvider === 'custom'
          ? (process.env['CUSTOM_LLM_MODEL'] || 'deepseek-coder')
          : (process.env['OLLAMA_MODEL'] || 'qwen2.5-coder:7b');

      res.json({
        host: this.host,
        port: this.port,
        repoRoot: this.repoRoot,
        authRequired: Boolean(this.authToken),
        activeProvider,
        activeModel,
        hasApiKey: Boolean(
          process.env['GEMINI_API_KEY'] ||
          process.env['OPENAI_API_KEY'] ||
          process.env['ANTHROPIC_API_KEY'] ||
          process.env['CUSTOM_LLM_API_KEY']
        ),
        availableProviders: [
          { id: 'ollama', name: 'Ollama (Local-First)', defaultModel: 'qwen2.5-coder:7b', defaultEndpoint: 'http://127.0.0.1:11434' },
          { id: 'gemini', name: 'Google Gemini', defaultModel: 'gemini-flash-latest', defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta' },
          { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-4o', defaultEndpoint: 'https://api.openai.com/v1' },
          { id: 'anthropic', name: 'Anthropic Claude', defaultModel: 'claude-3-5-sonnet-20241022', defaultEndpoint: 'https://api.anthropic.com/v1' },
          { id: 'custom', name: 'Custom OpenAI-Compatible (Groq/DeepSeek/Mistral)', defaultModel: 'deepseek-coder', defaultEndpoint: 'https://api.deepseek.com/v1' },
        ],
      });
    });

    this.app.post('/api/settings', async (req: Request, res: Response) => {
      try {
        const { provider, model, endpoint, apiKey, mode } = req.body as {
          provider: 'ollama' | 'gemini' | 'openai' | 'anthropic' | 'custom';
          model?: string;
          endpoint?: string;
          apiKey?: string;
          mode?: 'local' | 'cloud' | 'hybrid';
        };

        if (!provider) {
          res.status(400).json({ error: 'provider is required' });
          return;
        }

        const envUpdates: Record<string, string> = {
          CR_PROVIDER: provider,
        };

        const resolvedModel =
          model?.trim() ||
          (provider === 'gemini'
            ? 'gemini-flash-latest'
            : provider === 'openai'
            ? 'gpt-4o'
            : provider === 'anthropic'
            ? 'claude-3-5-sonnet-20241022'
            : provider === 'custom'
            ? 'deepseek-coder'
            : 'qwen2.5-coder:7b');

        if (provider === 'gemini') {
          envUpdates['GEMINI_MODEL'] = resolvedModel;
          if (apiKey && apiKey.trim().length > 0) envUpdates['GEMINI_API_KEY'] = apiKey.trim();
          if (endpoint) envUpdates['GEMINI_ENDPOINT'] = endpoint.trim();
        } else if (provider === 'openai') {
          envUpdates['OPENAI_MODEL'] = resolvedModel;
          if (apiKey && apiKey.trim().length > 0) envUpdates['OPENAI_API_KEY'] = apiKey.trim();
          if (endpoint) envUpdates['OPENAI_ENDPOINT'] = endpoint.trim();
        } else if (provider === 'anthropic') {
          envUpdates['ANTHROPIC_MODEL'] = resolvedModel;
          if (apiKey && apiKey.trim().length > 0) envUpdates['ANTHROPIC_API_KEY'] = apiKey.trim();
          if (endpoint) envUpdates['ANTHROPIC_ENDPOINT'] = endpoint.trim();
        } else if (provider === 'custom') {
          envUpdates['CUSTOM_LLM_MODEL'] = resolvedModel;
          if (apiKey && apiKey.trim().length > 0) envUpdates['CUSTOM_LLM_API_KEY'] = apiKey.trim();
          if (endpoint) envUpdates['CUSTOM_LLM_ENDPOINT'] = endpoint.trim();
        } else if (provider === 'ollama') {
          envUpdates['OLLAMA_MODEL'] = resolvedModel;
          if (endpoint) envUpdates['OLLAMA_ENDPOINT'] = endpoint.trim();
        }

        // Persist to .env file in repoRoot
        saveEnv(this.repoRoot, envUpdates);

        // Dynamically instantiate and register the provider on the live orchestrator
        const newProvider = createLLMProvider(provider, {
          apiKey: apiKey || (provider === 'gemini' ? process.env['GEMINI_API_KEY'] : undefined),
          model: resolvedModel,
          endpoint,
        });

        this.orchestrator.setProvider(newProvider);
        const resolvedMode = mode ?? (provider === 'ollama' ? 'local' : 'cloud');
        this.orchestrator.updateConfig({ mode: resolvedMode });

        this.broadcast({
          type: 'settings:updated',
          stage: 'settings',
          detail: `Active review provider switched to ${provider} (${resolvedModel})`,
          payload: { provider, model: resolvedModel, mode: resolvedMode },
        });

        res.json({
          success: true,
          activeProvider: provider,
          activeModel: resolvedModel,
          message: 'Settings saved to .env and applied to active review orchestrator.',
        });
      } catch (err: unknown) {
        res.status(500).json({ error: (err as Error).message });
      }
    });
  }

  async start(): Promise<{ host: string; port: number }> {
    return new Promise((resolve) => {
      this.server.listen(this.port, this.host, () => {
        resolve({ host: this.host, port: this.port });
      });
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      this.watcher.stop();
    }
    return new Promise((resolve) => {
      this.wss.close(() => {
        this.server.close(() => {
          resolve();
        });
      });
    });
  }
}
