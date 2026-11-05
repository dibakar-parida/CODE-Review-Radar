import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { RepositoryIndexer } from './repositoryIndexer.js';
import { SQLiteStorage } from './sqliteStorage.js';

describe('RepositoryIndexer (Incremental Re-Indexing)', () => {
  let tempDir: string;
  let storage: SQLiteStorage;
  let indexer: RepositoryIndexer;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cr-indexer-test-'));
    storage = new SQLiteStorage({ dbPath: ':memory:' });
    indexer = new RepositoryIndexer({
      repoRoot: tempDir,
      storage,
    });

    // Create initial files
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'src/math.ts'),
      'export function add(a: number, b: number) { return a + b; }\n',
      'utf-8'
    );
    await fs.writeFile(
      path.join(tempDir, 'src/app.ts'),
      'import { add } from "./math";\nexport function main() { return add(1, 2); }\n',
      'utf-8'
    );
  });

  afterAll(async () => {
    storage.close();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('performs full initial indexing', async () => {
    const stats = await indexer.indexRepository();

    expect(stats.totalFiles).toBe(2);
    expect(stats.indexedFiles).toBe(2);
    expect(stats.skippedFiles).toBe(0);

    const graph = indexer.getCodeGraph();
    const symbols = graph.getAllSymbols();
    expect(symbols.some((s) => s.name === 'add')).toBe(true);
    expect(symbols.some((s) => s.name === 'main')).toBe(true);
  });

  it('skips unmodified files during subsequent index runs', async () => {
    const stats = await indexer.indexRepository();

    expect(stats.totalFiles).toBe(2);
    expect(stats.indexedFiles).toBe(0); // Nothing changed!
    expect(stats.skippedFiles).toBe(2);
  });

  it('incrementally re-indexes only modified files', async () => {
    // Modify src/math.ts
    await fs.writeFile(
      path.join(tempDir, 'src/math.ts'),
      'export function add(a: number, b: number) { return a + b; }\nexport function subtract(a: number, b: number) { return a - b; }\n',
      'utf-8'
    );

    const stats = await indexer.indexRepository();

    expect(stats.indexedFiles).toBe(1); // Only math.ts was re-indexed!
    expect(stats.skippedFiles).toBe(1); // app.ts was skipped

    const symbols = indexer.getCodeGraph().getAllSymbols();
    expect(symbols.some((s) => s.name === 'subtract')).toBe(true);
  });

  it('purges deleted files from index', async () => {
    await fs.rm(path.join(tempDir, 'src/app.ts'));

    const stats = await indexer.indexRepository();

    expect(stats.deletedFiles).toBe(1);
    expect(indexer.getCodeGraph().getAllSymbols().some((s) => s.name === 'main')).toBe(false);
  });
});
