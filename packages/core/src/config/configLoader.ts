import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ReviewConfig, ReviewConfigSchema } from '@cr/shared';

export interface LoadConfigOptions {
  configPath?: string;
  cwd?: string;
}

export const DEFAULT_CONFIG_FILENAMES = ['.cr.yaml', '.cr.yml'];

/**
 * Searches and loads `.cr.yaml` with Zod validation and safe defaults.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<{
  config: ReviewConfig;
  filePath: string | null;
}> {
  const cwd = options.cwd ?? process.cwd();

  if (options.configPath) {
    const resolvedPath = path.resolve(cwd, options.configPath);
    try {
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const parsed = parseYaml(content);
      const validated = ReviewConfigSchema.parse(parsed ?? {});
      return { config: validated, filePath: resolvedPath };
    } catch (err: unknown) {
      throw new Error(`Failed to load config file at "${resolvedPath}": ${(err as Error).message}`);
    }
  }

  // Look for default file in cwd and parent dirs up to root
  let currentDir = cwd;
  while (true) {
    for (const filename of DEFAULT_CONFIG_FILENAMES) {
      const candidate = path.join(currentDir, filename);
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) {
          const content = await fs.readFile(candidate, 'utf-8');
          const parsed = parseYaml(content);
          const validated = ReviewConfigSchema.parse(parsed ?? {});
          return { config: validated, filePath: candidate };
        }
      } catch {
        // file doesn't exist, continue searching
      }
    }

    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }

  // Fallback to default schema values
  const defaultConfig = ReviewConfigSchema.parse({});
  return { config: defaultConfig, filePath: null };
}
