import { CodeSymbol, ImportLink, CallLink, RouteEndpoint, FileCodeIntelligence } from './astParser.js';

export class CodeGraph {
  // Symbol Name -> CodeSymbol[]
  private readonly symbolsByName = new Map<string, CodeSymbol[]>();
  // File Path -> CodeSymbol[]
  private readonly symbolsByFile = new Map<string, CodeSymbol[]>();
  // Callee Name -> Set of Caller Names
  private readonly callersByCallee = new Map<string, Set<string>>();
  // Caller Name -> Set of Callee Names
  private readonly calleesByCaller = new Map<string, Set<string>>();
  // File -> Routes
  private readonly routesByFile = new Map<string, RouteEndpoint[]>();
  // File -> Imports
  private readonly importsByFile = new Map<string, ImportLink[]>();

  clear(): void {
    this.symbolsByName.clear();
    this.symbolsByFile.clear();
    this.callersByCallee.clear();
    this.calleesByCaller.clear();
    this.routesByFile.clear();
    this.importsByFile.clear();
  }

  addFileIntelligence(intel: FileCodeIntelligence): void {
    this.removeFile(intel.filePath);

    // Symbols
    this.symbolsByFile.set(intel.filePath, intel.symbols);
    for (const sym of intel.symbols) {
      const list = this.symbolsByName.get(sym.name) ?? [];
      list.push(sym);
      this.symbolsByName.set(sym.name, list);
    }

    // Routes
    this.routesByFile.set(intel.filePath, intel.routes);

    // Imports
    this.importsByFile.set(intel.filePath, intel.imports);

    // Calls (bidirectional)
    for (const call of intel.calls) {
      // Callee -> Callers
      const callers = this.callersByCallee.get(call.calleeSymbol) ?? new Set();
      callers.add(call.callerSymbol);
      this.callersByCallee.set(call.calleeSymbol, callers);

      // Caller -> Callees
      const callees = this.calleesByCaller.get(call.callerSymbol) ?? new Set();
      callees.add(call.calleeSymbol);
      this.calleesByCaller.set(call.callerSymbol, callees);
    }
  }

  removeFile(filePath: string): void {
    const existingSymbols = this.symbolsByFile.get(filePath) ?? [];
    for (const sym of existingSymbols) {
      const list = this.symbolsByName.get(sym.name);
      if (list) {
        const filtered = list.filter((s) => s.filePath !== filePath);
        if (filtered.length > 0) {
          this.symbolsByName.set(sym.name, filtered);
        } else {
          this.symbolsByName.delete(sym.name);
        }
      }
    }
    this.symbolsByFile.delete(filePath);
    this.routesByFile.delete(filePath);
    this.importsByFile.delete(filePath);
  }

  /**
   * Finds the enclosing symbol for a given file and line range.
   */
  findEnclosingSymbol(filePath: string, line: number): CodeSymbol | null {
    const symbols = this.symbolsByFile.get(filePath) ?? [];
    for (const sym of symbols) {
      if (line >= sym.startLine && line <= sym.endLine) {
        return sym;
      }
    }
    return null;
  }

  /**
   * Finds all direct callers of a symbol.
   */
  getDirectCallers(symbolName: string): string[] {
    const callers = this.callersByCallee.get(symbolName);
    return callers ? Array.from(callers) : [];
  }

  /**
   * Finds transitive downstream callers up to maxDepth.
   */
  getTransitiveCallers(symbolName: string, maxDepth = 3): string[] {
    const visited = new Set<string>();
    const queue: Array<{ name: string; depth: number }> = [{ name: symbolName, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= maxDepth) continue;

      const direct = this.callersByCallee.get(current.name);
      if (direct) {
        for (const caller of direct) {
          if (!visited.has(caller) && caller !== symbolName) {
            visited.add(caller);
            queue.push({ name: caller, depth: current.depth + 1 });
          }
        }
      }
    }

    return Array.from(visited);
  }

  /**
   * Finds downstream API routes impacted by a set of symbols.
   */
  getImpactedRoutes(symbols: string[]): string[] {
    const symbolSet = new Set(symbols);
    const impacted = new Set<string>();

    for (const [_, routes] of this.routesByFile.entries()) {
      for (const route of routes) {
        if (symbolSet.has(route.handlerSymbol)) {
          impacted.add(`${route.method} ${route.path}`);
        }
      }
    }

    return Array.from(impacted);
  }

  getAllSymbols(): CodeSymbol[] {
    const all: CodeSymbol[] = [];
    for (const list of this.symbolsByFile.values()) {
      all.push(...list);
    }
    return all;
  }

  getAllRoutes(): RouteEndpoint[] {
    const all: RouteEndpoint[] = [];
    for (const list of this.routesByFile.values()) {
      all.push(...list);
    }
    return all;
  }

  getAllImports(): Map<string, ImportLink[]> {
    return new Map(this.importsByFile);
  }

  getImportsForFile(filePath: string): ImportLink[] {
    return this.importsByFile.get(filePath) ?? [];
  }
}
