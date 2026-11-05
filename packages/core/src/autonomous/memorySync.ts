import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import { TeamRule } from '@cr/shared';
import { SQLiteStorage } from '../indexing/sqliteStorage.js';

export interface SyncPayload {
  version: string;
  exportedAt: string;
  decisions: Array<{
    patternHash: string;
    ruleCategory: string;
    title: string;
    filePath: string;
    decision: 'accepted' | 'ignored';
    reason?: string;
  }>;
  teamRules: TeamRule[];
}

export interface ExportBundleOptions {
  storage: SQLiteStorage;
  passphrase: string;
  outputPath: string;
  teamRules?: TeamRule[];
}

export interface ImportBundleOptions {
  storage: SQLiteStorage;
  passphrase: string;
  bundlePath: string;
}

export interface ImportResult {
  importedDecisions: number;
  importedRules: number;
  teamRules: TeamRule[];
}

const MAGIC_HEADER = Buffer.from('CR_ENC_SYNC_V1\n');
const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;

export class EncryptedMemorySync {
  /**
   * Encrypts and exports review decisions and team rules to disk.
   */
  static async exportBundle(options: ExportBundleOptions): Promise<string> {
    const { storage, passphrase, outputPath, teamRules = [] } = options;

    // Collect decisions from storage
    const ignoredHashes = storage.getIgnoredHashes();
    const learned = storage.getLearnedConventions();

    const decisions: SyncPayload['decisions'] = [];
    for (const hash of ignoredHashes) {
      decisions.push({
        patternHash: hash,
        ruleCategory: 'security',
        title: 'Team Suppressed False-Positive',
        filePath: '*',
        decision: 'ignored',
        reason: 'Exported from team memory sync',
      });
    }

    for (const conv of learned) {
      decisions.push({
        patternHash: crypto.createHash('sha256').update(conv.title).digest('hex').slice(0, 16),
        ruleCategory: conv.category,
        title: conv.title,
        filePath: '*',
        decision: 'accepted',
        reason: 'Learned team pattern',
      });
    }

    const payload: SyncPayload = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      decisions,
      teamRules,
    };

    const plaintext = JSON.stringify(payload);
    const salt = crypto.randomBytes(SALT_LEN);
    const key = crypto.scryptSync(passphrase, salt, KEY_LEN);
    const iv = crypto.randomBytes(IV_LEN);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Bundle: [MAGIC_HEADER] [SALT (16)] [IV (12)] [AUTH_TAG (16)] [CIPHERTEXT]
    const bundle = Buffer.concat([MAGIC_HEADER, salt, iv, authTag, encrypted]);

    await fs.writeFile(outputPath, bundle);
    return outputPath;
  }

  /**
   * Decrypts and imports team review decisions into SQLite storage.
   */
  static async importBundle(options: ImportBundleOptions): Promise<ImportResult> {
    const { storage, passphrase, bundlePath } = options;

    const raw = await fs.readFile(bundlePath);

    // Verify magic header
    if (!raw.subarray(0, MAGIC_HEADER.length).equals(MAGIC_HEADER)) {
      throw new Error('Invalid bundle format: Missing CR_ENC_SYNC_V1 header');
    }

    let offset = MAGIC_HEADER.length;
    const salt = raw.subarray(offset, offset + SALT_LEN);
    offset += SALT_LEN;

    const iv = raw.subarray(offset, offset + IV_LEN);
    offset += IV_LEN;

    const authTag = raw.subarray(offset, offset + 16);
    offset += 16;

    const ciphertext = raw.subarray(offset);

    const key = crypto.scryptSync(passphrase, salt, KEY_LEN);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decryptedText = '';
    try {
      decryptedText = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
    } catch {
      throw new Error('Decryption failed: Incorrect passphrase or corrupted bundle data');
    }

    const payload = JSON.parse(decryptedText) as SyncPayload;
    let importedCount = 0;

    for (const d of payload.decisions) {
      storage.recordDecision(
        d.patternHash,
        d.ruleCategory,
        d.title,
        d.filePath,
        d.decision,
        d.reason
      );
      importedCount++;
    }

    return {
      importedDecisions: importedCount,
      importedRules: payload.teamRules.length,
      teamRules: payload.teamRules,
    };
  }
}
