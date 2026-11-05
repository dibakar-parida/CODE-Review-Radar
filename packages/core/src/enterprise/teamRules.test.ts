import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { TeamRuleEngine } from './teamRules.js';
import { FileDiff, TeamRule } from '@cr/shared';

describe('TeamRuleEngine', () => {
  let tempDir: string;
  let engine: TeamRuleEngine;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-team-rules-test-'));
    engine = new TeamRuleEngine({ repoRoot: tempDir });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('evaluates custom regex patterns on added diff lines', () => {
    const rules: TeamRule[] = [
      {
        id: 'RULE-NO-TODO',
        name: 'Forbidden TODO in production code',
        category: 'quality',
        severity: 'minor',
        pattern: '\\/\\/\\s*TODO:',
        explanation: 'TODO comments must not be committed to main; file an issue instead.',
      },
    ];

    const diff: FileDiff = {
      oldPath: 'src/index.ts',
      newPath: 'src/index.ts',
      status: 'modified',
      raw: '+ // TODO: refactor this method later',
      hunks: [
        {
          oldStart: 10,
          oldLines: 0,
          newStart: 10,
          newLines: 1,
          header: '@@ -10,0 +10,1 @@',
          lines: ['+ // TODO: refactor this method later'],
        },
      ],
    };

    const findings = engine.evaluate(diff, rules);
    expect(findings.length).toBe(1);
    expect(findings[0]!.title).toContain('Forbidden TODO in production code');
    expect(findings[0]!.severity).toBe('minor');
    expect(findings[0]!.verifiedBy).toContain('team-rule');
  });

  it('detects forbidden function blocks across added lines', () => {
    const rules: TeamRule[] = [
      {
        id: 'SEC-FORBIDDEN-EVAL',
        name: 'Block dangerous dynamic code execution',
        category: 'security',
        severity: 'critical',
        forbiddenFunctions: ['eval', 'Function'],
        explanation: 'Dynamic execution introduces critical RCE vectors.',
      },
    ];

    const diff: FileDiff = {
      oldPath: 'src/evaluator.ts',
      newPath: 'src/evaluator.ts',
      status: 'modified',
      raw: '+ const result = eval(untrustedInput);',
      hunks: [
        {
          oldStart: 5,
          oldLines: 0,
          newStart: 5,
          newLines: 1,
          header: '@@ -5,0 +5,1 @@',
          lines: ['+ const result = eval(untrustedInput);'],
        },
      ],
    };

    const findings = engine.evaluate(diff, rules);
    expect(findings.length).toBe(1);
    expect(findings[0]!.title).toContain('Forbidden Function Call: eval');
    expect(findings[0]!.severity).toBe('critical');
  });

  it('enforces required headers for matching file patterns', () => {
    const rules: TeamRule[] = [
      {
        id: 'LEGAL-COPYRIGHT',
        name: 'Enforce Organization Copyright Header',
        category: 'quality',
        severity: 'major',
        filePattern: '*.ts',
        requiredHeaders: ['// Copyright (c) 2026 Acme Corp'],
        explanation: 'All TypeScript files must begin with the company copyright banner.',
      },
    ];

    const diffWithoutHeader: FileDiff = {
      oldPath: 'src/api/service.ts',
      newPath: 'src/api/service.ts',
      status: 'added',
      raw: 'export const run = () => true;',
      hunks: [],
    };

    const findings = engine.evaluate(diffWithoutHeader, rules);
    expect(findings.length).toBe(1);
    expect(findings[0]!.title).toContain('Missing Required Header');
    expect(findings[0]!.explanation).toContain('company copyright banner');

    // With header present
    const diffWithHeader: FileDiff = {
      oldPath: 'src/api/service.ts',
      newPath: 'src/api/service.ts',
      status: 'added',
      raw: '// Copyright (c) 2026 Acme Corp\nexport const run = () => true;',
      hunks: [],
    };

    expect(engine.evaluate(diffWithHeader, rules).length).toBe(0);
  });

  it('loads external YAML rulepacks and resolves extends inheritance', async () => {
    // 1. Base rulepack
    const basePath = path.join(tempDir, 'base-rules.yaml');
    await fs.writeFile(
      basePath,
      `name: Base Security Rules
version: 1.0.0
rules:
  - id: BASE-01
    name: No Hardcoded Localhost in Prod
    category: security
    severity: major
    pattern: "http://localhost:"
    explanation: Do not commit local URLs.
`,
      'utf-8'
    );

    // 2. Child rulepack extending base
    const childPath = path.join(tempDir, 'team-rules.yaml');
    await fs.writeFile(
      childPath,
      `name: Team Extended Rules
version: 1.1.0
extends:
  - ${basePath.replace(/\\/g, '/')}
rules:
  - id: TEAM-02
    name: Require Strict Types
    category: quality
    severity: minor
    pattern: "any;"
    explanation: Avoid using explicit any.
`,
      'utf-8'
    );

    const rules = await engine.resolveAllRules([], [childPath]);
    expect(rules.length).toBe(2);
    expect(rules.map((r) => r.id)).toContain('BASE-01');
    expect(rules.map((r) => r.id)).toContain('TEAM-02');
  });
});
