import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorage } from './sqliteStorage.js';
import { FileCodeIntelligence } from './astParser.js';

describe('SQLiteStorage', () => {
  let storage: SQLiteStorage;

  beforeEach(() => {
    storage = new SQLiteStorage({ dbPath: ':memory:' });
  });

  afterEach(() => {
    storage.close();
  });

  it('persists file metadata, symbols, imports, calls, and routes', () => {
    const intel: FileCodeIntelligence = {
      filePath: 'src/core.ts',
      language: 'typescript',
      symbols: [
        {
          name: 'startEngine',
          filePath: 'src/core.ts',
          kind: 'function',
          startLine: 1,
          endLine: 10,
          signature: 'startEngine()',
        },
      ],
      imports: [
        {
          filePath: 'src/core.ts',
          sourceModule: './engine',
          importedSymbol: 'Engine',
          isDefault: true,
          line: 1,
        },
      ],
      calls: [
        {
          filePath: 'src/core.ts',
          callerSymbol: 'startEngine',
          calleeSymbol: 'ignite',
          line: 5,
        },
      ],
      routes: [
        {
          filePath: 'src/core.ts',
          method: 'POST',
          path: '/engine/start',
          handlerSymbol: 'startEngine',
          line: 12,
        },
      ],
    };

    storage.saveFileIntelligence(intel, 'hash123', 1700000000);

    const record = storage.getFileRecord('src/core.ts');
    expect(record).toBeDefined();
    expect(record!.hash).toBe('hash123');
    expect(record!.mtime).toBe(1700000000);

    const loaded = storage.loadAllIntelligence();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.symbols).toHaveLength(1);
    expect(loaded[0]!.symbols[0]!.name).toBe('startEngine');
    expect(loaded[0]!.calls[0]!.calleeSymbol).toBe('ignite');
    expect(loaded[0]!.routes[0]!.path).toBe('/engine/start');
  });

  it('removes file records upon deletion', () => {
    const intel: FileCodeIntelligence = {
      filePath: 'src/temp.ts',
      language: 'typescript',
      symbols: [{ name: 'tempFunc', filePath: 'src/temp.ts', kind: 'function', startLine: 1, endLine: 2 }],
      imports: [],
      calls: [],
      routes: [],
    };

    storage.saveFileIntelligence(intel, 'hash999', 12345);
    expect(storage.getFileRecord('src/temp.ts')).not.toBeNull();

    storage.removeFile('src/temp.ts');
    expect(storage.getFileRecord('src/temp.ts')).toBeNull();
    expect(storage.loadAllIntelligence()).toHaveLength(0);
  });

  it('stores and retrieves embeddings metadata', () => {
    const vec = [0.12, 0.45, -0.67, 0.89];
    storage.saveEmbedding('startEngine', 'src/core.ts', vec);

    const all = storage.getEmbeddings();
    expect(all).toHaveLength(1);
    expect(all[0]!.symbolName).toBe('startEngine');
    expect(all[0]!.vector).toEqual(vec);
  });
});
