import { FileDiff, GitHunk } from '@cr/shared';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

export const SECRET_RULES: RedactionRule[] = [
  // Private Key Blocks
  {
    name: 'Private Key Block',
    pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    replacement: '[REDACTED:PRIVATE_KEY_BLOCK]',
  },
  // Anthropic API Key (must be before generic sk- OpenAI)
  {
    name: 'Anthropic API Key',
    pattern: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g,
    replacement: '[REDACTED:ANTHROPIC_KEY]',
  },
  // OpenAI API Key
  {
    name: 'OpenAI API Key',
    pattern: /\bsk-[a-zA-Z0-9_-]{20,}\b/g,
    replacement: '[REDACTED:OPENAI_KEY]',
  },
  // AWS Access Key ID
  {
    name: 'AWS Access Key ID',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED:AWS_ACCESS_KEY_ID]',
  },
  // GitHub Personal Access Token
  {
    name: 'GitHub Token',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9a-zA-Z]{36}\b/g,
    replacement: '[REDACTED:GITHUB_TOKEN]',
  },
  // GitHub Fine-grained PAT
  {
    name: 'GitHub Fine-grained PAT',
    pattern: /\bgithub_pat_[0-9a-zA-Z_]{82}\b/g,
    replacement: '[REDACTED:GITHUB_PAT]',
  },
  // Slack Token
  {
    name: 'Slack Token',
    pattern: /\bxox[baprs]-[0-9a-zA-Z-]{10,72}\b/g,
    replacement: '[REDACTED:SLACK_TOKEN]',
  },
  // Database Connection URIs with credentials
  {
    name: 'Database URI with Password',
    pattern: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[a-zA-Z0-9_\-\.]+:[^@\s"']+@[a-zA-Z0-9_\-\.]+(?::\d+)?\/?[^\s"']*/g,
    replacement: '[REDACTED:DATABASE_URI]',
  },
  // Bearer Token in Headers / Strings
  {
    name: 'Bearer Token',
    pattern: /Bearer\s+[a-zA-Z0-9_\-\.]{25,}\b/g,
    replacement: 'Bearer [REDACTED:BEARER_TOKEN]',
  },
  // Generic Password / Secret assignments (at end as fallback; never re-redact already redacted tokens)
  {
    name: 'Hardcoded Secret Assignment',
    pattern: /((?:password|passwd|api_?key|auth_?token|client_?secret|jwt_?secret)\s*[:=]\s*["'])(?!\[REDACTED:)([^"']{8,})(["'])/gi,
    replacement: '$1[REDACTED:SECRET_VALUE]$3',
  },
];

export interface RedactionResult {
  redactedText: string;
  secretsFound: number;
  detectedTypes: string[];
}

export class SecretRedactor {
  private readonly rules: RedactionRule[];

  constructor(customRules?: RedactionRule[]) {
    this.rules = customRules ?? SECRET_RULES;
  }

  /**
   * Redacts secrets in text using regex rules.
   * Creates fresh regex instances per rule to guarantee zero state leakage across calls.
   */
  redactText(text: string): RedactionResult {
    let result = text;
    let secretsFound = 0;
    const detected = new Set<string>();

    for (const rule of this.rules) {
      // Recreate regex with same source and flags to avoid lastIndex persistence
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      const matches = result.match(regex);
      if (matches && matches.length > 0) {
        secretsFound += matches.length;
        detected.add(rule.name);
        // Fresh regex for replacement
        const replaceRegex = new RegExp(rule.pattern.source, rule.pattern.flags);
        result = result.replace(replaceRegex, rule.replacement);
      }
    }

    return {
      redactedText: result,
      secretsFound,
      detectedTypes: Array.from(detected),
    };
  }

  /**
   * Redacts secrets across all raw lines and hunks of a FileDiff before egress.
   */
  redactFileDiff(diff: FileDiff): { redactedDiff: FileDiff; secretsFound: number; detectedTypes: string[] } {
    let totalSecrets = 0;
    const allTypes = new Set<string>();

    const rawResult = this.redactText(diff.raw);
    totalSecrets += rawResult.secretsFound;
    rawResult.detectedTypes.forEach((t) => allTypes.add(t));

    const redactedHunks: GitHunk[] = diff.hunks.map((hunk) => {
      const newLines: string[] = hunk.lines.map((l) => {
        const lineResult = this.redactText(l);
        if (lineResult.secretsFound > 0) {
          lineResult.detectedTypes.forEach((t) => allTypes.add(t));
        }
        return lineResult.redactedText;
      });

      return {
        ...hunk,
        lines: newLines,
      };
    });

    return {
      redactedDiff: {
        ...diff,
        raw: rawResult.redactedText,
        hunks: redactedHunks,
      },
      secretsFound: totalSecrets,
      detectedTypes: Array.from(allTypes),
    };
  }

  /**
   * Optional check for native gitleaks CLI availability.
   */
  async isGitleaksAvailable(): Promise<boolean> {
    try {
      await execFileAsync('gitleaks', ['version'], { windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }
}
