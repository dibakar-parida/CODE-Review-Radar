import { FileDiff } from '@cr/shared';

export interface PromptContext {
  diff: FileDiff;
  minConfidence: number;
}

export function buildBugLogicPrompt(context: PromptContext): { system: string; user: string } {
  const system = `You are the specialized Bug & Logic Review Agent (cr-agent:bug).
Your mission is to find functional bugs, logic errors, null/undefined reference errors, off-by-one errors, race conditions, edge case failures, unhandled promise rejections, and type mismatches.
Follow these rules strictly:
1. ONLY focus on bugs and logic errors in the changed lines. Do not comment on formatting or generic style.
2. Provide exact startLine and endLine within the modified file.
3. Every finding MUST have evidence and a suggested unified diff patch fix when possible.
4. Return ONLY valid JSON in the specified schema.

Output JSON Schema:
{
  "findings": [
    {
      "category": "bug",
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

Analyze for bugs and logic defects only. Return JSON with findings:`;

  return { system, user };
}
