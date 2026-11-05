import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { UnifiedReviewOrchestrator } from './unifiedReviewOrchestrator.js';
import { MockLLMProvider } from '../llm/provider.js';
import { ReviewConfigSchema, ReviewFinding } from '@cr/shared';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('UnifiedReviewOrchestrator end-to-end with Mock Provider', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-orchestrator-test-'));

    // Initialize git
    await execFileAsync('git', ['init'], { cwd: tempDir });
    await execFileAsync('git', ['config', 'user.name', 'Tester'], { cwd: tempDir });
    await execFileAsync('git', ['config', 'user.email', 'tester@local.test'], { cwd: tempDir });

    const sample = path.join(tempDir, 'auth.ts');
    await fs.writeFile(sample, 'export function login() {\n  return true;\n}\n', 'utf-8');
    await execFileAsync('git', ['add', '.'], { cwd: tempDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: tempDir });

    // Make an unstaged modification
    await fs.writeFile(
      sample,
      'export function login(user: string) {\n  const token = eval(user);\n  return token;\n}\n',
      'utf-8'
    );
  });

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('runs complete review pipeline on unstaged target and returns verified findings', async () => {
    const mockProvider = new MockLLMProvider([
      {
        category: 'security',
        severity: 'critical',
        confidence: 0.95,
        startLine: 2,
        endLine: 2,
        title: 'Dangerous eval() use in authentication path',
        explanation: 'Dynamic code execution with eval can lead to Remote Code Execution',
        evidence: 'const token = eval(user);',
        suggestedPatch: '--- a/auth.ts\n+++ b/auth.ts\n@@ -2,1 +2,1 @@\n- const token = eval(user);\n+ const token = verify(user);\n',
      },
    ]);

    const orchestrator = new UnifiedReviewOrchestrator({
      cwd: tempDir,
      provider: mockProvider,
    });

    const result = await orchestrator.runReview({ type: 'unstaged' });

    expect(result.summary.totalFindings).toBe(1);
    expect(result.summary.bySeverity.critical).toBe(1);
    expect(result.findings[0]!.id).toBe('SEC-001');
    expect(result.findings[0]!.title).toContain('Dangerous eval()');
    expect(result.findings[0]!.verifiedBy).toContain('ast');
  });

  it('scrubs secrets prior to sending code slices in hybrid/cloud mode', async () => {
    // Modify existing tracked file to include an API key
    const authFile = path.join(tempDir, 'auth.ts');
    await fs.writeFile(
      authFile,
      'export function login() {\n  const apiKey = "sk-1234567890abcdefghijklmnopqrstuvwxyz";\n  return apiKey;\n}\n',
      'utf-8'
    );

    let receivedDiffRaw = '';
    const mockProvider = {
      name: 'spy-provider',
      async isAvailable() {
        return true;
      },
      async analyzeDiff(diff: any) {
        receivedDiffRaw = diff.raw;
        return [
          {
            id: 'SEC-001',
            category: 'security' as const,
            severity: 'critical' as const,
            confidence: 0.99,
            filePath: 'auth.ts',
            startLine: 2,
            endLine: 2,
            title: 'Leaked API Key',
            explanation: 'Found key in diff',
            evidence: 'key',
            verifiedBy: ['llm' as const],
          },
        ];
      },
    };

    const config = ReviewConfigSchema.parse({
      mode: 'cloud',
      review: {
        categories: ['security'],
      },
      security: {
        secretRedaction: true,
      },
    });

    const orchestrator = new UnifiedReviewOrchestrator({
      cwd: tempDir,
      config,
      provider: mockProvider,
    });

    await orchestrator.runReview({ type: 'unstaged' });

    // The raw diff passed to provider must be redacted
    expect(receivedDiffRaw).toContain('[REDACTED:OPENAI_KEY]');
    expect(receivedDiffRaw).not.toContain('sk-1234567890abcdefghijklmnopqrstuvwxyz');
  });

  it('suppresses previously dismissed false-positive findings via review memory', async () => {
    const authFile = path.join(tempDir, 'auth.ts');
    await fs.writeFile(
      authFile,
      'export function login(user: string) {\n  const token = eval(user);\n  return token;\n}\n',
      'utf-8'
    );

    const mockFinding = {
      category: 'security' as const,
      severity: 'critical' as const,
      confidence: 0.95,
      startLine: 2,
      endLine: 2,
      title: 'Dangerous eval() use in authentication path',
      explanation: 'Dynamic code execution with eval can lead to Remote Code Execution',
      evidence: 'const token = eval(user);',
    };

    const mockProvider = new MockLLMProvider([mockFinding]);

    const orchestrator = new UnifiedReviewOrchestrator({
      cwd: tempDir,
      provider: mockProvider,
    });

    // Run first review - finding should be present
    const firstResult = await orchestrator.runReview({ type: 'unstaged' });
    expect(firstResult.findings.length).toBe(1);

    // Developer marks the finding as ignored
    orchestrator.getReviewMemory().recordDecision(firstResult.findings[0]!, 'ignored', 'Dismissed as false-positive');

    // Run second review - finding must now be suppressed!
    const secondResult = await orchestrator.runReview({ type: 'unstaged' });
    expect(secondResult.findings.length).toBe(0);
    expect(secondResult.summary.totalFindings).toBe(0);
  });
});
