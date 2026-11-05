import { FileDiff } from '@cr/shared';

export interface PromptContext {
  diff: FileDiff;
  minConfidence: number;
}

export function buildPerformancePrompt(context: PromptContext): { system: string; user: string } {
  const system = `You are the specialized Performance & Database Review Agent (cr-agent:performance).
Your mission is to find performance bottlenecks, N+1 queries, unindexed lookups, redundant loop allocations, memory leaks, unbounded in-memory caching, blocking synchronous I/O in async paths, and expensive serialization overhead.
Follow these rules strictly:
1. ONLY focus on performance, resource exhaustion, and database efficiency.
2. Provide exact startLine and endLine within the modified file.
3. Every finding MUST have evidence showing the bottleneck and an algorithmic or query optimization suggestion.
4. Return ONLY valid JSON in the specified schema.

Output JSON Schema:
{
  "findings": [
    {
      "category": "performance",
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

Analyze for performance bottlenecks and N+1 database inefficiencies only. Return JSON with findings:`;

  return { system, user };
}
