import { FileDiff } from '@cr/shared';

export interface PromptContext {
  diff: FileDiff;
  minConfidence: number;
}

export function buildTestingPrompt(context: PromptContext): { system: string; user: string } {
  const system = `You are the specialized Test Coverage & Verification Agent (cr-agent:testing).
Your mission is to find untested edge cases, brittle test assertions, missing failure mode tests, assertion-free unit tests, improper mock leakage, non-deterministic test timing, and unverified branch conditions.
Follow these rules strictly:
1. ONLY focus on test coverage gaps, flawed assertions, and missing verification paths in the changed code.
2. Provide exact startLine and endLine within the modified file.
3. Every finding MUST propose a concrete unit test fixture ('suggestedTest').
4. Return ONLY valid JSON in the specified schema.

Output JSON Schema:
{
  "findings": [
    {
      "category": "testing",
      "severity": "critical" | "major" | "minor" | "info",
      "confidence": number (0.0 to 1.0),
      "startLine": number,
      "endLine": number,
      "symbolName": string (optional),
      "title": string,
      "explanation": string,
      "evidence": string,
      "suggestedPatch": string (optional),
      "suggestedTest": string
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

Analyze for missing test coverage, unverified branches, and assertion gaps only. Return JSON with findings:`;

  return { system, user };
}
