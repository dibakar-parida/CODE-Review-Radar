import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { EncryptedMemorySync } from './memorySync.js';
import { SQLiteStorage } from '../indexing/sqliteStorage.js';
import { TeamRule } from '@cr/shared';

describe('EncryptedMemorySync', () => {
  let sourceStorage: SQLiteStorage;
  let targetStorage: SQLiteStorage;
  let tempDir: string;
  let bundlePath: string;
  const passphrase = 'SuperSecretTeamSyncKey2026!';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-sync-test-'));
    bundlePath = path.join(tempDir, 'team-memory.enc');

    sourceStorage = new SQLiteStorage({ dbPath: ':memory:' });
    targetStorage = new SQLiteStorage({ dbPath: ':memory:' });

    // Seed source storage with decisions
    sourceStorage.recordDecision('hash-sec-01', 'security', 'Dismissed JWT False-Positive', 'src/auth.ts', 'ignored', 'Dev review approved');
    sourceStorage.recordDecision('hash-bug-02', 'bug', 'Null Pointer Guard Pattern', 'src/db.ts', 'accepted', 'Convention verified');
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

  it('exports encrypted bundle and imports cleanly into another database', async () => {
    const customRules: TeamRule[] = [
      {
        id: 'TEAM-001',
        name: 'No unhashed passwords',
        category: 'security',
        severity: 'critical',
        pattern: 'password\\s*=\\s*["\']',
        explanation: 'Do not assign raw plaintext passwords',
      },
    ];

    await EncryptedMemorySync.exportBundle({
      storage: sourceStorage,
      passphrase,
      outputPath: bundlePath,
      teamRules: customRules,
    });

    const fileStat = await fs.stat(bundlePath);
    expect(fileStat.size).toBeGreaterThan(64);

    // Import into target storage
    const result = await EncryptedMemorySync.importBundle({
      storage: targetStorage,
      passphrase,
      bundlePath,
    });

    expect(result.importedDecisions).toBeGreaterThanOrEqual(2);
    expect(result.importedRules).toBe(1);
    expect(result.teamRules[0]!.id).toBe('TEAM-001');

    // Verify target storage now contains the imported decisions
    const targetIgnored = targetStorage.getIgnoredHashes();
    expect(targetIgnored.has('hash-sec-01')).toBe(true);

    const targetLearned = targetStorage.getLearnedConventions();
    expect(targetLearned.some((c) => c.title === 'Null Pointer Guard Pattern')).toBe(true);
  });

  it('fails decryption cleanly when given an incorrect passphrase', async () => {
    await EncryptedMemorySync.exportBundle({
      storage: sourceStorage,
      passphrase,
      outputPath: bundlePath,
    });

    await expect(
      EncryptedMemorySync.importBundle({
        storage: targetStorage,
        passphrase: 'WrongPassword!',
        bundlePath,
      })
    ).rejects.toThrow(/Decryption failed: Incorrect passphrase/);
  });
});
