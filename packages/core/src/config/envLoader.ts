import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Loads environment variables from `.env` and `.env.local` in the target directory into `process.env`.
 */
export function loadEnv(dir: string = process.cwd()): Record<string, string> {
  const loaded: Record<string, string> = {};
  const envFiles = ['.env.local', '.env'];

  for (const file of envFiles) {
    const fullPath = path.resolve(dir, file);
    try {
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            // Remove wrapping double or single quotes
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            if (!process.env[key] || process.env[key] === '') {
              process.env[key] = val;
            }
            loaded[key] = val;
          }
        }
      }
    } catch {
      // quiet fallback
    }
  }

  return loaded;
}

/**
 * Persists updated environment variables to `.env` file in the specified directory.
 */
export function saveEnv(dir: string = process.cwd(), updates: Record<string, string>): void {
  const envPath = path.resolve(dir, '.env');
  let content = '';
  try {
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf-8');
    }
  } catch {
    content = '';
  }

  const lines = content.split('\n');
  const existingKeys = new Set<string>();
  const updatedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const key = trimmed.slice(0, trimmed.indexOf('=')).trim();
      existingKeys.add(key);
      if (key in updates) {
        updatedLines.push(`${key}=${updates[key]}`);
        process.env[key] = updates[key];
        continue;
      }
    }
    updatedLines.push(line);
  }

  for (const [key, val] of Object.entries(updates)) {
    if (!existingKeys.has(key)) {
      updatedLines.push(`${key}=${val}`);
      process.env[key] = val;
    }
  }

  fs.writeFileSync(envPath, updatedLines.join('\n').trim() + '\n', 'utf-8');
}
