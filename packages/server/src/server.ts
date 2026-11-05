import * as http from 'node:http';
import express, { Request, Response } from 'express';
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
} from '@cr/core';
import { SwarmReviewWatcher } from './watcher.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  repoRoot?: string;
  orchestrator?: UnifiedReviewOrchestrator;
  indexer?: RepositoryIndexer;
}

export class LocalReviewServer {
  public readonly app: express.Express;
  public readonly server: http.Server;
  public readonly wss: WebSocketServer;
  public readonly host: string;
  public readonly port: number;

  private readonly repoRoot: string;
  private readonly orchestrator: UnifiedReviewOrchestrator;
  private readonly indexer: RepositoryIndexer;
  private watcher?: SwarmReviewWatcher;

  constructor(options: ServerOptions = {}) {
    // Strictly bind to 127.0.0.1 by default for Clean-Room isolation
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 3100;
    this.repoRoot = options.repoRoot ?? process.cwd();

    this.orchestrator =
      options.orchestrator ??
      new UnifiedReviewOrchestrator({ cwd: this.repoRoot });
    this.indexer =
      options.indexer ?? new RepositoryIndexer({ repoRoot: this.repoRoot });

    this.app = express();
    this.app.use(cors({ origin: /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/ }));
    this.app.use(express.json());

    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: '/events/progress' });

    this.initWebSocket();
    this.initRoutes();
  }

  private initWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
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
