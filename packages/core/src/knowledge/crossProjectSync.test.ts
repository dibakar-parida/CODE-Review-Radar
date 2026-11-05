import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { CrossProjectSync } from './crossProjectSync.js';
import { SQLiteStorage } from '../indexing/sqliteStorage.js';
import { TeamRule } from '@cr/shared';

describe('CrossProjectSync', () => {
  let sourceStorage: SQLiteStorage;
  let targetStorage: SQLiteStorage;
  let tempDir: string;
  let bundlePath: string;
  const passphrase = 'EnterpriseCrossProjectKey2026!';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-cross-sync-test-'));
    bundlePath = path.join(tempDir, 'enterprise-rules.enc');

    sourceStorage = new SQLiteStorage({ dbPath: ':memory:' });
    targetStorage = new SQLiteStorage({ dbPath: ':memory:' });

    sourceStorage.recordDecision('hash-sec-99', 'security', 'Approved Cloud KMS Secret Rotation', 'src/kms.ts', 'accepted', 'Enterprise architectural standard');
  });

  afterEach(async () => {
    sourceStorage.close();
    targetStorage.close();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('exports cross-project encrypted bundle and imports with namespace isolation', async () => {
    const rules: TeamRule[] = [
      {
        id: 'CORP-RULE-01',
        name: 'Strict TLS 1.3 requirement',
        category: 'security',
        severity: 'critical',
        pattern: 'minVersion:\\s*[\'"]TLSv1\\.3[\'"]',
        explanation: 'Enforce modern cryptographic transport protocol across all corporate services.',
      },
    ];

    await CrossProjectSync.exportCrossProjectBundle({
      storage: sourceStorage,
      sourceRepoId: 'auth-service',
      scope: 'global',
      passphrase,
      outputPath: bundlePath,
      teamRules: rules,
    });

    const result = await CrossProjectSync.importCrossProjectBundle({
      storage: targetStorage,
      passphrase,
      bundlePath,
    });

    expect(result.sourceRepoId).toBe('auth-service');
    expect(result.importedRules).toBe(1);
    expect(result.importedDecisions).toBeGreaterThanOrEqual(1);

    const conventions = targetStorage.getLearnedConventions();
    expect(conventions.some((c) => c.title.includes('[auth-service] Approved Cloud KMS Secret Rotation'))).toBe(true);
  });
});
