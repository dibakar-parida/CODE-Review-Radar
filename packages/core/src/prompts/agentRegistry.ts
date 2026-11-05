import { ReviewCategory, FileDiff } from '@cr/shared';
import { buildBugLogicPrompt } from './bugLogicPrompt.js';
import { buildSecurityPrompt } from './securityPrompt.js';
import { buildPerformancePrompt } from './performancePrompt.js';
import { buildArchitecturePrompt } from './architecturePrompt.js';
import { buildQualityPrompt } from './qualityPrompt.js';
import { buildTestingPrompt } from './testingPrompt.js';

export interface AgentPromptGenerator {
  (context: { diff: FileDiff; minConfidence: number; conventions?: string }): { system: string; user: string };
}

export const AGENT_PROMPTS: Record<ReviewCategory, AgentPromptGenerator> = {
  bug: buildBugLogicPrompt,
  security: buildSecurityPrompt,
  performance: buildPerformancePrompt,
  architecture: buildArchitecturePrompt,
  quality: buildQualityPrompt,
  testing: buildTestingPrompt,
};

export function getAgentPromptForCategory(
  category: ReviewCategory,
  context: { diff: FileDiff; minConfidence: number; conventions?: string }
): { system: string; user: string } {
  const generator = AGENT_PROMPTS[category] ?? buildBugLogicPrompt;
  const res = generator(context);
  if (context.conventions && context.conventions.trim().length > 0) {
    return {
      system: res.system,
      user: `${res.user}\n\nLearned Repository Conventions & Accepted Patterns:\n${context.conventions}`,
    };
  }
  return res;
}
