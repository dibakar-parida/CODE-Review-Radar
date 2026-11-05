import * as readline from 'node:readline/promises';
import { Command } from 'commander';
import { ReviewTarget, ReviewTargetType } from '@cr/shared';
import {
  UnifiedReviewOrchestrator,
  AtomicTransactionManager,
  TestGenerator,
} from '@cr/core';

export interface FixCommandOptions {
  target?: string;
  config?: string;
  yes?: boolean;
  verify?: boolean;
  withTests?: boolean;
}

export function createFixCommand(): Command {
  const fix = new Command('fix')
    .description('Interactive approval-gated auto-fix with atomic rollback')
    .option(
      '-t, --target <type>',
      'Target changes to fix (staged, unstaged, commit, branch, files)',
      'staged'
    )
    .option('-c, --config <path>', 'Custom path to .cr.yaml config')
    .option('-y, --yes', 'Approve all patches non-interactively without prompts', false)
    .option('--no-verify', 'Skip post-patch typecheck verification')
    .option('--with-tests', 'Generate regression test fixtures for approved fixes', false)
    .action(async (options: FixCommandOptions) => {
      try {
        console.log('⚡ Scanning review findings for verified auto-fixes...\n');
        const orchestrator = new UnifiedReviewOrchestrator({
          cwd: process.cwd(),
          configPath: options.config,
        });

        const targetType = (options.target || 'staged') as ReviewTargetType;
        const target: ReviewTarget = { type: targetType };
        const result = await orchestrator.runReview(target);

        const fixableFindings = result.findings.filter((f) => Boolean(f.suggestedPatch));

        if (fixableFindings.length === 0) {
          console.log('✔ No automated patch suggestions available for this review target.');
          return;
        }

        console.log(`Found ${fixableFindings.length} fixable finding(s):\n`);

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        let autoApproveAll = Boolean(options.yes);
        const shouldVerify = options.verify !== false;
        const testGen = new TestGenerator(process.cwd());

        let appliedCount = 0;
        let rolledBackCount = 0;

        for (let i = 0; i < fixableFindings.length; i++) {
          const f = fixableFindings[i]!;

          console.log(`─────────────────────────────────────────────────────────────`);
          console.log(`[${f.id}] ${f.title} (${f.severity.toUpperCase()})`);
          console.log(`File: ${f.filePath}:${f.startLine}-${f.endLine}`);
          console.log(`Explanation: ${f.explanation}`);
          console.log(`\nProposed Patch:`);
          for (const line of f.suggestedPatch!.split('\n')) {
            if (line.startsWith('+')) {
              console.log(`\x1b[32m${line}\x1b[0m`);
            } else if (line.startsWith('-')) {
              console.log(`\x1b[31m${line}\x1b[0m`);
            } else {
              console.log(`\x1b[90m${line}\x1b[0m`);
            }
          }
          console.log('');

          let shouldApply = autoApproveAll;

          if (!autoApproveAll) {
            const answer = (
              await rl.question(`Apply patch for ${f.id}? [y]es / [n]o / [a]ll / [q]uit: `)
            )
              .trim()
              .toLowerCase();

            if (answer === 'q' || answer === 'quit') {
              console.log('\nAborted by user.');
              break;
            } else if (answer === 'a' || answer === 'all') {
              autoApproveAll = true;
              shouldApply = true;
            } else if (answer === 'y' || answer === 'yes') {
              shouldApply = true;
            } else {
              console.log(`Skipped ${f.id}.\n`);
              continue;
            }
          }

          if (shouldApply) {
            const tx = new AtomicTransactionManager(process.cwd());
            await tx.applyPatchToFile(f.filePath, f.suggestedPatch!);

            if (options.withTests && (f.suggestedTest || f.category === 'testing' || f.category === 'bug')) {
              const fixture = testGen.generateTestFixture(f);
              await testGen.saveTestFixture(fixture, tx);
              console.log(`  + Generated regression test: ${fixture.testFilePath}`);
            }

            if (shouldVerify) {
              process.stdout.write('  Verifying with tsc --noEmit...');
              const verifyResult = await tx.verifyAndCommit({ runTypecheck: true });
              if (verifyResult.success) {
                console.log(' \x1b[32m✔ Verified & Committed!\x1b[0m\n');
                appliedCount++;
              } else {
                console.log(' \x1b[31m✖ Failed!\x1b[0m');
                console.log(`\x1b[33m${verifyResult.error}\x1b[0m\n`);
                rolledBackCount++;
              }
            } else {
              tx.verifyAndCommit();
              console.log('  \x1b[32m✔ Patch applied (verification skipped)\x1b[0m\n');
              appliedCount++;
            }
          }
        }

        rl.close();
        console.log(`─────────────────────────────────────────────────────────────`);
        console.log(`Summary: ${appliedCount} fix(es) committed, ${rolledBackCount} rolled back.`);
      } catch (err: unknown) {
        console.error(`\n✖ Error during cr fix: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return fix;
}
