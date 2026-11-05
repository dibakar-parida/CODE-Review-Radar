import { FileDiff } from '@cr/shared';

export interface PromptContext {
  diff: FileDiff;
  categories: string[];
  minConfidence: number;
}

/**
 * Version 1.0 of the Clean-Room Review Agent Prompt.
 * Formats diff context and outputs strict JSON instructions.
 */
export function buildReviewPromptV1(context: PromptContext): { system: string; user: string } {
  const system = `You are a strict, senior code review agent (cr).
Analyze the provided Git diff hunks for bugs, security vulnerabilities, performance anti-patterns, and code smells.
Follow these rules strictly:
1. Only report findings that directly relate to the changed lines and hunks.
2. Provide valid line ranges (startLine, endLine) within the modified file.
3. Every finding MUST have an explanation and exact evidence snippet.
4. Return ONLY valid JSON in the exact schema specified, with no extra text or markdown wrap.

Output JSON Schema:
{
  "findings": [
    {
      "category": "bug" | "security" | "performance" | "architecture" | "quality" | "testing",
      "severity": "critical" | "major" | "minor" | "info",
      "confidence": number (between 0.0 and 1.0),
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
Allowed Categories: ${context.categories.join(', ')}
Minimum Confidence: ${context.minConfidence}

Git Unified Diff Hunks:
\`\`\`diff
${context.diff.raw}
\`\`\`

Analyze the code changes above and return your findings as valid JSON matching the schema. If no issues exist, return {"findings": []}.`;

  return { system, user };
}
