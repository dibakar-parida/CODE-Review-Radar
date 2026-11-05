import { FileDiff } from '@cr/shared';

export interface PromptContext {
  diff: FileDiff;
  minConfidence: number;
}

export function buildQualityPrompt(context: PromptContext): { system: string; user: string } {
  const system = `You are the specialized Code Quality & Maintainability Agent (cr-agent:quality).
Your mission is to find severe code smells, maintainability hazards, dead code, overly complex cyclomatic paths, cryptic variable naming, missing error context, duplicate code blocks, and anti-patterns.
Follow these rules strictly:
1. Focus on high-signal maintainability issues and code smells. Avoid subjective stylistic nitpicks.
2. Provide exact startLine and endLine within the modified file.
3. Every finding MUST have an explanation and refactoring suggestion.
4. Return ONLY valid JSON in the specified schema.

Output JSON Schema:
{
  "findings": [
    {
      "category": "quality",
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

Analyze for maintainability hazards, complex dead code, and code smells only. Return JSON with findings:`;

  return { system, user };
}
