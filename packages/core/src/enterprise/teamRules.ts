import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as yaml from 'yaml';
import {
  FileDiff,
  ReviewFinding,
  TeamRule,
  TeamRulepack,
  TeamRulepackSchema,
  generateFindingId,
} from '@cr/shared';

export interface TeamRuleEngineOptions {
  repoRoot?: string;
}

export class TeamRuleEngine {
  private readonly repoRoot: string;

  constructor(options: TeamRuleEngineOptions = {}) {
    this.repoRoot = options.repoRoot ?? process.cwd();
  }

  /**
   * Loads and parses team rulepack files (.yaml, .yml, .json) from disk.
   */
  async loadRulepackFile(filePath: string): Promise<TeamRulepack> {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.repoRoot, filePath);

    const raw = await fs.readFile(fullPath, 'utf-8');
    let parsed: unknown;
    if (filePath.endsWith('.json')) {
      parsed = JSON.parse(raw);
    } else {
      parsed = yaml.parse(raw);
    }

    const rulepack = TeamRulepackSchema.parse(parsed);

    // Recursively resolve extended rulepacks
    if (rulepack.extends && rulepack.extends.length > 0) {
      for (const parentPath of rulepack.extends) {
        const parentRulepack = await this.loadRulepackFile(parentPath);
        rulepack.rules = [...parentRulepack.rules, ...rulepack.rules];
      }
    }

    return rulepack;
  }

  /**
   * Loads all configured rulepacks and merges them with inline rules.
   */
  async resolveAllRules(inlineRules: TeamRule[] = [], rulepackPaths: string[] = []): Promise<TeamRule[]> {
    const allRules: TeamRule[] = [...inlineRules];

    for (const rulepackPath of rulepackPaths) {
      try {
        const pack = await this.loadRulepackFile(rulepackPath);
        allRules.push(...pack.rules);
      } catch (err: unknown) {
        console.warn(`[TeamRuleEngine] Warning: Could not load rulepack "${rulepackPath}": ${(err as Error).message}`);
      }
    }

    // Deduplicate rules by ID
    const unique = new Map<string, TeamRule>();
    for (const r of allRules) {
      unique.set(r.id, r);
    }

    return Array.from(unique.values());
  }

  /**
   * Evaluates team rules against a modified/added file diff.
   */
  evaluate(fileDiff: FileDiff, rules: TeamRule[]): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    const filePath = fileDiff.newPath || fileDiff.oldPath || 'unknown';
    let count = 1;

    for (const rule of rules) {
      // Check file pattern filter
      if (rule.filePattern && !this.matchesPattern(filePath, rule.filePattern)) {
        continue;
      }

      // 1. Check Regex Pattern on added diff lines
      if (rule.pattern) {
        const regex = new RegExp(rule.pattern, 'i');
        for (const hunk of fileDiff.hunks) {
          for (let i = 0; i < hunk.lines.length; i++) {
            const line = hunk.lines[i] ?? '';
            if (!line.startsWith('+')) continue;

            const codeLine = line.slice(1);
            if (regex.test(codeLine)) {
              const lineNum = hunk.newStart + i;
              findings.push({
                id: generateFindingId(rule.category, count++),
                category: rule.category,
                severity: rule.severity,
                confidence: 1.0,
                filePath,
                startLine: lineNum,
                endLine: lineNum,
                title: `[Team Rule] ${rule.name}`,
                explanation: rule.explanation,
                evidence: line.trim(),
                suggestedPatch: rule.suggestedPatch,
                verifiedBy: ['team-rule'],
              });
            }
          }
        }
      }

      // 2. Check Forbidden Function Identifiers
      if (rule.forbiddenFunctions && rule.forbiddenFunctions.length > 0) {
        for (const forbidden of rule.forbiddenFunctions) {
          const fnRegex = new RegExp(`\\b${this.escapeRegex(forbidden)}\\s*\\(`, 'g');
          for (const hunk of fileDiff.hunks) {
            for (let i = 0; i < hunk.lines.length; i++) {
              const line = hunk.lines[i] ?? '';
              if (!line.startsWith('+')) continue;

              const codeLine = line.slice(1);
              if (fnRegex.test(codeLine)) {
                const lineNum = hunk.newStart + i;
                findings.push({
                  id: generateFindingId(rule.category, count++),
                  category: rule.category,
                  severity: rule.severity,
                  confidence: 1.0,
                  filePath,
                  startLine: lineNum,
                  endLine: lineNum,
                  title: `[Team Rule] Forbidden Function Call: ${forbidden}`,
                  explanation: `Organization policy prohibits use of "${forbidden}": ${rule.explanation}`,
                  evidence: line.trim(),
                  verifiedBy: ['team-rule'],
                });
              }
            }
          }
        }
      }

      // 3. Check Required Headers (for added files or modified header regions)
      if (rule.requiredHeaders && rule.requiredHeaders.length > 0) {
        const fullContent = fileDiff.raw || '';
        for (const header of rule.requiredHeaders) {
          if (!fullContent.includes(header)) {
            findings.push({
              id: generateFindingId(rule.category, count++),
              category: rule.category,
              severity: rule.severity,
              confidence: 0.95,
              filePath,
              startLine: 1,
              endLine: 1,
              title: `[Team Rule] Missing Required Header: "${header}"`,
              explanation: `File does not contain required header "${header}". Policy: ${rule.explanation}`,
              evidence: fullContent.split('\n')[0] || '',
              verifiedBy: ['team-rule'],
            });
          }
        }
      }
    }

    return findings;
  }

  private matchesPattern(filePath: string, pattern: string): boolean {
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1);
      return filePath.endsWith(ext);
    }
    if (pattern.endsWith('/**')) {
      const dir = pattern.slice(0, -3);
      return filePath.startsWith(dir);
    }
    return filePath.includes(pattern);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
