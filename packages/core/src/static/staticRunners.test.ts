import { describe, it, expect } from 'vitest';
import { TscRunner } from './tscRunner.js';
import { EslintRunner } from './eslintRunner.js';
import { SemgrepRunner } from './semgrepRunner.js';

describe('Deterministic Static Analysis Output Parsers', () => {
  it('TscRunner parses tsc compiler diagnostic lines', () => {
    const tscOutput = `
src/index.ts(14,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/utils.ts(45,10): error TS2304: Cannot find name 'unknownVariable'.
`;
    const runner = new TscRunner({ cwd: process.cwd() });
    const targetPaths = new Set(['src/index.ts', 'src/utils.ts']);
    const findings = runner.parseTscOutput(tscOutput, targetPaths);

    expect(findings).toHaveLength(2);
    expect(findings[0]!.category).toBe('bug');
    expect(findings[0]!.severity).toBe('critical');
    expect(findings[0]!.confidence).toBe(1.0);
    expect(findings[0]!.verifiedBy).toContain('tsc');
    expect(findings[0]!.filePath).toBe('src/index.ts');
    expect(findings[0]!.startLine).toBe(14);
    expect(findings[0]!.title).toContain('TS2322');
  });

  it('EslintRunner parses JSON output report', () => {
    const eslintJson = JSON.stringify([
      {
        filePath: 'packages/core/src/app.ts',
        messages: [
          {
            ruleId: 'no-unused-vars',
            severity: 2,
            message: "'unused' is defined but never used.",
            line: 22,
            endLine: 22,
          },
        ],
      },
    ]);

    const runner = new EslintRunner({ cwd: process.cwd() });
    const findings = runner.parseEslintOutput(eslintJson);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('quality');
    expect(findings[0]!.severity).toBe('major');
    expect(findings[0]!.verifiedBy).toContain('eslint');
    expect(findings[0]!.title).toContain('no-unused-vars');
    expect(findings[0]!.startLine).toBe(22);
  });

  it('SemgrepRunner parses semgrep JSON scan results', () => {
    const semgrepJson = JSON.stringify({
      results: [
        {
          check_id: 'javascript.express.security.audit.xss.direct-response-write',
          path: 'src/routes/user.ts',
          start: { line: 55 },
          end: { line: 58 },
          extra: {
            message: 'Detected unescaped user input passed directly to response.send()',
            severity: 'ERROR',
            lines: 'res.send("Hello " + req.query.name);',
          },
        },
      ],
    });

    const runner = new SemgrepRunner({ cwd: process.cwd() });
    const findings = runner.parseSemgrepOutput(semgrepJson);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('security');
    expect(findings[0]!.severity).toBe('critical');
    expect(findings[0]!.confidence).toBe(1.0);
    expect(findings[0]!.verifiedBy).toContain('semgrep');
    expect(findings[0]!.title).toContain('direct-response-write');
    expect(findings[0]!.startLine).toBe(55);
  });
});
