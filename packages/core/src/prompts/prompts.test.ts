import { describe, it, expect } from 'vitest';
import { FileDiff } from '@cr/shared';
import { buildBugLogicPrompt } from './bugLogicPrompt.js';
import { buildSecurityPrompt } from './securityPrompt.js';
import { buildPerformancePrompt } from './performancePrompt.js';
import { buildArchitecturePrompt } from './architecturePrompt.js';
import { buildQualityPrompt } from './qualityPrompt.js';
import { buildTestingPrompt } from './testingPrompt.js';
import { getAgentPromptForCategory } from './agentRegistry.js';

describe('Multi-Agent Role-Scoped Prompts', () => {
  const dummyDiff: FileDiff = {
    oldPath: 'src/service.ts',
    newPath: 'src/service.ts',
    status: 'modified',
    raw: '@@ -10,3 +10,4 @@\n context\n+newCode();\n',
    hunks: [],
  };

  it('generates Bug & Logic prompt focused on functional defects', () => {
    const { system, user } = buildBugLogicPrompt({ diff: dummyDiff, minConfidence: 0.8 });
    expect(system).toContain('cr-agent:bug');
    expect(system).toContain('null/undefined reference errors');
    expect(user).toContain('src/service.ts');
  });

  it('generates Security prompt focused on vulnerabilities & injection', () => {
    const { system, user } = buildSecurityPrompt({ diff: dummyDiff, minConfidence: 0.8 });
    expect(system).toContain('cr-agent:security');
    expect(system).toContain('SQL, Command, Shell');
    expect(user).toContain('src/service.ts');
  });

  it('generates Performance prompt focused on bottlenecks and N+1 queries', () => {
    const { system, user } = buildPerformancePrompt({ diff: dummyDiff, minConfidence: 0.8 });
    expect(system).toContain('cr-agent:performance');
    expect(system).toContain('N+1 queries');
  });

  it('generates Architecture prompt focused on blast radius & boundaries', () => {
    const { system, user } = buildArchitecturePrompt({ diff: dummyDiff, minConfidence: 0.8 });
    expect(system).toContain('cr-agent:architecture');
    expect(system).toContain('blastRadius');
  });

  it('generates Quality prompt focused on code smells and complexity', () => {
    const { system, user } = buildQualityPrompt({ diff: dummyDiff, minConfidence: 0.8 });
    expect(system).toContain('cr-agent:quality');
    expect(system).toContain('code smells');
  });

  it('generates Testing prompt requiring concrete suggestedTest fixtures', () => {
    const { system, user } = buildTestingPrompt({ diff: dummyDiff, minConfidence: 0.8 });
    expect(system).toContain('cr-agent:testing');
    expect(system).toContain('suggestedTest');
  });

  it('correctly resolves generator through agent registry', () => {
    const prompt = getAgentPromptForCategory('performance', { diff: dummyDiff, minConfidence: 0.7 });
    expect(prompt.system).toContain('cr-agent:performance');
  });
});
