import { describe, it, expect } from 'vitest';
import { WebhookEmulator } from './webhookEmulator.js';
import { ReviewResult } from '@cr/shared';

describe('WebhookEmulator', () => {
  it('parses GitHub pull_request.opened webhook payloads', () => {
    const payload = {
      action: 'opened',
      number: 101,
      pull_request: {
        number: 101,
        head: { ref: 'feature/payment-v2', sha: 'abc1234' },
        base: { ref: 'main' },
      },
      repository: {
        full_name: 'acme/ecommerce-platform',
      },
      sender: { login: 'dev-alice' },
    };

    const event = WebhookEmulator.parsePayload(payload, {
      'x-github-event': 'pull_request',
    });

    expect(event.provider).toBe('github');
    expect(event.event).toBe('pull_request.opened');
    expect(event.branch).toBe('feature/payment-v2');
    expect(event.baseBranch).toBe('main');
    expect(event.commitSha).toBe('abc1234');
    expect(event.sender).toBe('dev-alice');
  });

  it('parses GitHub push webhook payloads', () => {
    const payload = {
      ref: 'refs/heads/release/v1.2.0',
      after: 'def5678',
      repository: { full_name: 'acme/core' },
      pusher: { name: 'ci-bot' },
    };

    const event = WebhookEmulator.parsePayload(payload, {
      'x-github-event': 'push',
    });

    expect(event.provider).toBe('github');
    expect(event.event).toBe('push');
    expect(event.branch).toBe('release/v1.2.0');
    expect(event.commitSha).toBe('def5678');
  });

  it('parses GitLab merge_request webhook payloads', () => {
    const payload = {
      object_kind: 'merge_request',
      object_attributes: {
        iid: 42,
        action: 'open',
        source_branch: 'fix/login-bug',
        target_branch: 'develop',
        last_commit: { id: '9876xyz' },
      },
      project: { path_with_namespace: 'team/api' },
      user: { username: 'bob' },
    };

    const event = WebhookEmulator.parsePayload(payload, {
      'x-gitlab-event': 'Merge Request Hook',
    });

    expect(event.provider).toBe('gitlab');
    expect(event.event).toBe('merge_request.open');
    expect(event.branch).toBe('fix/login-bug');
    expect(event.baseBranch).toBe('develop');
    expect(event.commitSha).toBe('9876xyz');
  });

  it('formats GitHub check run with failure conclusion on critical findings', () => {
    const event = {
      provider: 'github' as const,
      event: 'pull_request.opened',
      repoName: 'acme/store',
      branch: 'feature/checkout',
      baseBranch: 'main',
    };

    const result: ReviewResult = {
      summary: {
        target: { type: 'branch', ref: 'feature/checkout' },
        executionMode: 'local',
        modelName: 'mock',
        totalFindings: 1,
        bySeverity: { critical: 1, major: 0, minor: 0, info: 0 },
        byCategory: { bug: 1, security: 0, performance: 0, architecture: 0, quality: 0, testing: 0 },
        filesAnalyzed: 2,
        durationMs: 350,
        timestamp: '2026-11-05T00:00:00.000Z',
      },
      findings: [
        {
          id: 'BUG-001',
          category: 'bug',
          severity: 'critical',
          confidence: 0.99,
          filePath: 'src/checkout.ts',
          startLine: 12,
          endLine: 14,
          title: 'Unchecked Null Pointer',
          explanation: 'Accessing cart.items without null check',
          evidence: 'cart.items.length',
          verifiedBy: ['ast'],
        },
      ],
      diffReport: {
        target: { type: 'branch', ref: 'feature/checkout' },
        files: [],
        totalInsertions: 10,
        totalDeletions: 2,
      },
    };

    const checkRun = WebhookEmulator.formatCheckRun(event, result);
    expect(checkRun.status).toBe('completed');
    expect(checkRun.conclusion).toBe('failure');
    expect(checkRun.annotationsCount).toBe(1);
    expect(checkRun.annotations[0]!.annotation_level).toBe('failure');
    expect(checkRun.annotations[0]!.path).toBe('src/checkout.ts');
  });
});
