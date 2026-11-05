import { FileDiff } from '@cr/shared';

export interface PromptContext {
  diff: FileDiff;
  minConfidence: number;
}

export function buildArchitecturePrompt(context: PromptContext): { system: string; user: string } {
  const system = `You are the specialized Architecture & Blast Radius Review Agent (cr-agent:architecture).
Your mission is to find architectural antipatterns, circular dependencies, leaking abstractions, boundary/contract violations, breaking API changes, tightly coupled domains, and unversioned public interface breaking changes.
Follow these rules strictly:
1. ONLY focus on system architecture, layering violations, package isolation, and API contract breakage.
2. Provide exact startLine and endLine within the modified file.
3. Every finding MUST outline the blast radius of impacted callers or downstream modules.
4. Return ONLY valid JSON in the specified schema.

Output JSON Schema:
{
  "findings": [
    {
      "category": "architecture",
      "severity": "critical" | "major" | "minor" | "info",
      "confidence": number (0.0 to 1.0),
      "startLine": number,
      "endLine": number,
      "symbolName": string (optional),
      "title": string,
      "explanation": string,
      "evidence": string,
      "blastRadius": string[] (optional),
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

Analyze for architectural violations, layer leakage, and breaking API contracts only. Return JSON with findings:`;

  return { system, user };
}
