import { describe, it, expect } from 'vitest';
import { formatCheckRunTerminal } from './webhook.js';
import { WebhookCheckRunResponse } from '@cr/shared';

describe('Local CI/CD Webhook Emulator (cr webhook)', () => {
  it('formats terminal check run output with success status when clean', () => {
    const checkRun: WebhookCheckRunResponse = {
      status: 'completed',
      conclusion: 'success',
      title: '✔ cr: All Review Checks Passed (feature/login ➔ main)',
      summary: '### Review Result for `acme/repo` (`feature/login`)\n- **Status:** SUCCESS',
      annotationsCount: 0,
      annotations: [],
    };

    const output = formatCheckRunTerminal(checkRun);
    expect(output).toContain('CI/CD WEBHOOK EMULATOR');
    expect(output).toContain('SUCCESS');
    expect(output).toContain('All Review Checks Passed');
  });

  it('formats terminal check run output with annotations on failure', () => {
    const checkRun: WebhookCheckRunResponse = {
      status: 'completed',
      conclusion: 'failure',
      title: '✖ cr: 1 Blocking Issue(s) Detected (feature/auth ➔ main)',
      summary: '### Review Result for `acme/repo`\n- **Status:** FAILURE',
      annotationsCount: 1,
      annotations: [
        {
          path: 'src/auth.ts',
          start_line: 10,
          end_line: 12,
          annotation_level: 'failure',
          title: '[SECURITY] Hardcoded API Token',
          message: 'Found active token in commit',
          raw_details: 'apiKey = "sk-12345"',
        },
      ],
    };

    const output = formatCheckRunTerminal(checkRun);
    expect(output).toContain('FAILURE');
    expect(output).toContain('Annotations (1):');
    expect(output).toContain('src/auth.ts:10-12');
    expect(output).toContain('Hardcoded API Token');
  });
});
