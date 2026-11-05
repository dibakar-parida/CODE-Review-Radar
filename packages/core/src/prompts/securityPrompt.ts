import { FileDiff } from '@cr/shared';

export interface PromptContext {
  diff: FileDiff;
  minConfidence: number;
}

export function buildSecurityPrompt(context: PromptContext): { system: string; user: string } {
  const system = `You are the specialized Security Review Agent (cr-agent:security).
Your mission is to find security vulnerabilities, including injection attacks (SQL, Command, Shell, Template), insecure deserialization, broken access control, SSRF, hardcoded credentials or API keys, path traversal, CSRF/XSS, and insecure crypto.
Follow these rules strictly:
1. ONLY focus on security vulnerabilities, permission flaws, and data leakage.
2. Provide exact startLine and endLine within the modified file.
3. Every finding MUST have evidence and an explanation of the attack vector or blast radius.
4. Return ONLY valid JSON in the specified schema.

Output JSON Schema:
{
  "findings": [
    {
      "category": "security",
      "severity": "critical" | "major" | "minor" | "info",
      "confidence": number (0.0 to 1.0),
      "startLine": number,
      "endLine": number,
      "symbolName": string (optional),
      "title": string,
      "explanation": string,
      "evidence": string,
      "suggestedPatch": string (optional),
      "suggestedTest": string (optional)
    }
  ]
}`;

  const user = `Target File: ${context.diff.newPath || context.diff.oldPath}
Status: ${context.diff.status}
Minimum Confidence: ${context.minConfidence}

Git Diff Hunks:
\`\`\`diff
${context.diff.raw}
\`\`\`

Analyze for security vulnerabilities and dangerous operations only. Return JSON with findings:`;

  return { system, user };
}
