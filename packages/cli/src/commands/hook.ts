import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Command } from 'commander';

export const PRE_COMMIT_HOOK_CONTENT = `#!/usr/bin/env sh
# Installed by cr (Local-First AI Code Review System)
# Automatically reviews staged changes and blocks critical defects

echo "⚡ [cr] Running pre-commit review..."

if command -v cr >/dev/null 2>&1; then
  cr review --target staged --fail-on-critical
elif command -v npx >/dev/null 2>&1; then
  npx cr review --target staged --fail-on-critical
else
  node ./packages/cli/dist/bin/cr.js review --target staged --fail-on-critical
fi

EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "✖ [cr] Pre-commit review failed: Critical issues detected in staged files."
  echo "  Run 'cr fix' to inspect and auto-remediate, or fix the findings before committing."
  exit $EXIT_CODE
fi

exit 0
`;

export async function findGitHooksDir(repoRoot: string): Promise<string> {
  const gitDir = path.join(repoRoot, '.git');
  try {
    const stat = await fs.stat(gitDir);
    if (!stat.isDirectory()) {
      throw new Error(`Path ${gitDir} is not a directory.`);
    }
  } catch (err: unknown) {
    throw new Error(`Not a git repository (missing .git directory in ${repoRoot})`);
  }

  const hooksDir = path.join(gitDir, 'hooks');
  await fs.mkdir(hooksDir, { recursive: true });
  return hooksDir;
}

export async function installGitHook(repoRoot: string = process.cwd()): Promise<string> {
  const hooksDir = await findGitHooksDir(repoRoot);
  const hookPath = path.join(hooksDir, 'pre-commit');

  // Normalize line endings to LF for cross-platform POSIX sh execution
  const lfContent = PRE_COMMIT_HOOK_CONTENT.replace(/\r\n/g, '\n');
  await fs.writeFile(hookPath, lfContent, { encoding: 'utf-8', mode: 0o755 });

  // Explicitly ensure chmod 755
  try {
    await fs.chmod(hookPath, 0o755);
  } catch {
    // Windows chmod may be a no-op, which is harmless
  }

  return hookPath;
}

export async function uninstallGitHook(repoRoot: string = process.cwd()): Promise<boolean> {
  const hooksDir = await findGitHooksDir(repoRoot);
  const hookPath = path.join(hooksDir, 'pre-commit');

  try {
    await fs.unlink(hookPath);
    return true;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return false; // already doesn't exist
    }
    throw err;
  }
}

export async function isGitHookInstalled(repoRoot: string = process.cwd()): Promise<boolean> {
  try {
    const hooksDir = await findGitHooksDir(repoRoot);
    const hookPath = path.join(hooksDir, 'pre-commit');
    await fs.access(hookPath);
    return true;
  } catch {
    return false;
  }
}

export function createHookCommand(): Command {
  const hook = new Command('hook')
    .description('Manage Git pre-commit hooks for automated code review');

  hook
    .command('install')
    .description('Install local git pre-commit hook in .git/hooks/pre-commit')
    .action(async () => {
      try {
        const hookPath = await installGitHook();
        console.log(`✔ Git pre-commit hook installed successfully at ${hookPath}`);
        console.log('⚡ All subsequent "git commit" commands will automatically review staged changes.');
      } catch (err: unknown) {
        console.error(`✖ Failed to install git hook: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  hook
    .command('uninstall')
    .description('Remove cr pre-commit hook from .git/hooks/pre-commit')
    .action(async () => {
      try {
        const removed = await uninstallGitHook();
        if (removed) {
          console.log('✔ Git pre-commit hook uninstalled successfully.');
        } else {
          console.log('ℹ No pre-commit hook found in .git/hooks/.');
        }
      } catch (err: unknown) {
        console.error(`✖ Failed to uninstall git hook: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  hook
    .command('status')
    .description('Check if cr pre-commit hook is currently active')
    .action(async () => {
      try {
        const installed = await isGitHookInstalled();
        if (installed) {
          console.log('✔ cr pre-commit hook is active (.git/hooks/pre-commit)');
        } else {
          console.log('○ cr pre-commit hook is NOT installed. Run "cr hook install" to enable it.');
        }
      } catch (err: unknown) {
        console.error(`✖ Error checking hook status: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  return hook;
}
