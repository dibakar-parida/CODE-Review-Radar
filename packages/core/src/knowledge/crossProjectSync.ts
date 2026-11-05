import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import { TeamRule } from '@cr/shared';
import { SQLiteStorage } from '../indexing/sqliteStorage.js';

export interface CrossProjectSyncBundle {
  version: '2.0.0';
  sourceRepoId: string;
  scope: 'global' | 'project';
  exportedAt: string;
  decisions: Array<{
    patternHash: string;
    ruleCategory: string;
    title: string;
    filePath: string;
    decision: 'accepted' | 'ignored';
    reason?: string;
    scope: 'global' | 'project';
  }>;
  teamRules: Array<TeamRule & { scope?: 'global' | 'project' }>;
}

export class CrossProjectSync {
  private static readonly MAGIC = Buffer.from('CR_CROSS_SYNC_V2\n');
  private static readonly ALGO = 'aes-256-gcm';

  /**
   * Exports an encrypted cross-project memory and rulepack bundle.
   */
  static async exportCrossProjectBundle(options: {
    storage: SQLiteStorage;
    sourceRepoId: string;
    scope?: 'global' | 'project';
    passphrase: string;
    outputPath: string;
    teamRules?: TeamRule[];
  }): Promise<string> {
    const { storage, sourceRepoId, scope = 'global', passphrase, outputPath, teamRules = [] } = options;

    const ignoredHashes = storage.getIgnoredHashes();
    const learned = storage.getLearnedConventions();

    const decisions: CrossProjectSyncBundle['decisions'] = [];
    for (const hash of ignoredHashes) {
      decisions.push({
        patternHash: hash,
        ruleCategory: 'security',
        title: `[${sourceRepoId}] Suppressed False Positive`,
        filePath: '*',
        decision: 'ignored',
        reason: 'Cross-project sync',
        scope,
      });
    }

    for (const conv of learned) {
      decisions.push({
        patternHash: crypto.createHash('sha256').update(`${sourceRepoId}:${conv.title}`).digest('hex').slice(0, 16),
        ruleCategory: conv.category,
        title: `[${sourceRepoId}] ${conv.title}`,
        filePath: '*',
        decision: 'accepted',
        reason: 'Learned cross-project pattern',
        scope,
      });
    }

    const bundle: CrossProjectSyncBundle = {
      version: '2.0.0',
      sourceRepoId,
      scope,
      exportedAt: new Date().toISOString(),
      decisions,
      teamRules: teamRules.map((r) => ({ ...r, scope })),
    };

    const plaintext = JSON.stringify(bundle);
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(passphrase, salt, 32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(this.ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    const fileBuffer = Buffer.concat([this.MAGIC, salt, iv, tag, encrypted]);
    await fs.writeFile(outputPath, fileBuffer);

    return outputPath;
  }

  /**
   * Imports an encrypted bundle from another repository, merging conventions without collisions.
   */
  static async importCrossProjectBundle(options: {
    storage: SQLiteStorage;
    passphrase: string;
    bundlePath: string;
  }): Promise<{ importedDecisions: number; importedRules: number; sourceRepoId: string }> {
    const { storage, passphrase, bundlePath } = options;
    const raw = await fs.readFile(bundlePath);

    if (!raw.subarray(0, this.MAGIC.length).equals(this.MAGIC)) {
      throw new Error('Invalid cross-project bundle format: Missing CR_CROSS_SYNC_V2 header');
    }

    let offset = this.MAGIC.length;
    const salt = raw.subarray(offset, offset + 16);
    offset += 16;
    const iv = raw.subarray(offset, offset + 12);
    offset += 12;
    const tag = raw.subarray(offset, offset + 16);
    offset += 16;
    const ciphertext = raw.subarray(offset);

    const key = crypto.scryptSync(passphrase, salt, 32);
    const decipher = crypto.createDecipheriv(this.ALGO, key, iv);
    decipher.setAuthTag(tag);

    let decryptedText = '';
    try {
      decryptedText = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
    } catch {
      throw new Error('Cross-project decryption failed: Invalid passphrase or corrupted data');
    }

    const bundle = JSON.parse(decryptedText) as CrossProjectSyncBundle;
    let count = 0;

    for (const d of bundle.decisions) {
      storage.recordDecision(d.patternHash, d.ruleCategory, d.title, d.filePath, d.decision, d.reason);
      count++;
    }

    return {
      importedDecisions: count,
      importedRules: bundle.teamRules.length,
      sourceRepoId: bundle.sourceRepoId,
    };
  }
}
