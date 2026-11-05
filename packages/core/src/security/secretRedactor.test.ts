import { describe, it, expect } from 'vitest';
import { SecretRedactor } from './secretRedactor.js';
import { FileDiff } from '@cr/shared';

describe('SecretRedactor (Pre-Egress Secret Scrubbing)', () => {
  const redactor = new SecretRedactor();

  it('redacts OpenAI API keys', () => {
    const input = 'const client = new OpenAI({ apiKey: "sk-proj-abc12345678901234567890123456" });';
    const result = redactor.redactText(input);
    expect(result.secretsFound).toBeGreaterThanOrEqual(1);
    expect(result.redactedText).toContain('[REDACTED:OPENAI_KEY]');
    expect(result.redactedText).not.toContain('sk-proj-abc12345678901234567890123456');
    expect(result.detectedTypes).toContain('OpenAI API Key');
  });

  it('redacts Anthropic API keys', () => {
    const input = 'export const ANTHROPIC_KEY = "sk-ant-api03-abcdefghijklmn1234567890";';
    const result = redactor.redactText(input);
    expect(result.secretsFound).toBe(1);
    expect(result.redactedText).toContain('[REDACTED:ANTHROPIC_KEY]');
    expect(result.redactedText).not.toContain('sk-ant-api03-abcdefghijklmn1234567890');
    expect(result.detectedTypes).toContain('Anthropic API Key');
  });

  it('redacts AWS Access Key IDs', () => {
    const input = 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE';
    const result = redactor.redactText(input);
    expect(result.secretsFound).toBe(1);
    expect(result.redactedText).toContain('[REDACTED:AWS_ACCESS_KEY_ID]');
    expect(result.redactedText).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redacts GitHub personal access tokens', () => {
    const input = 'const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";';
    const result = redactor.redactText(input);
    expect(result.secretsFound).toBe(1);
    expect(result.redactedText).toContain('[REDACTED:GITHUB_TOKEN]');
    expect(result.redactedText).not.toContain('ghp_1234567890abcdefghijklmnopqrstuvwxyz');
  });

  it('redacts database connection URIs with credentials', () => {
    const input = 'DATABASE_URL="postgres://postgres:supersecretpassword123@db.internal.net:5432/production"';
    const result = redactor.redactText(input);
    expect(result.secretsFound).toBe(1);
    expect(result.redactedText).toContain('[REDACTED:DATABASE_URI]');
    expect(result.redactedText).not.toContain('supersecretpassword123');
  });

  it('redacts private key blocks', () => {
    const input =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0m4w17...fakekeydata...\n-----END RSA PRIVATE KEY-----';
    const result = redactor.redactText(input);
    expect(result.secretsFound).toBe(1);
    expect(result.redactedText).toBe('[REDACTED:PRIVATE_KEY_BLOCK]');
  });

  it('redacts full FileDiff hunks and raw diff strings cleanly', () => {
    const diff: FileDiff = {
      oldPath: 'config.ts',
      newPath: 'config.ts',
      status: 'modified',
      raw: '--- a/config.ts\n+++ b/config.ts\n@@ -1,1 +1,1 @@\n+const key = "sk-1234567890abcdefghijklmnopqrstuvwxyz";\n',
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          header: '@@ -1,1 +1,1 @@',
          lines: ['+const key = "sk-1234567890abcdefghijklmnopqrstuvwxyz";'],
        },
      ],
    };

    const { redactedDiff, secretsFound } = redactor.redactFileDiff(diff);
    expect(secretsFound).toBeGreaterThanOrEqual(1);
    expect(redactedDiff.raw).toContain('[REDACTED:OPENAI_KEY]');
    expect(redactedDiff.hunks[0]!.lines[0]).toContain('[REDACTED:OPENAI_KEY]');
    expect(redactedDiff.raw).not.toContain('sk-1234567890abcdefghijklmnopqrstuvwxyz');
  });
});
