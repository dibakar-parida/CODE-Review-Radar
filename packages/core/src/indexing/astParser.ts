import * as path from 'node:path';
import { normalizeToPosix } from '../git/diffParser.js';

export type SymbolKind = 'function' | 'method' | 'class' | 'interface' | 'type' | 'variable' | 'route';

export interface CodeSymbol {
  name: string;
  filePath: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  enclosingSymbol?: string;
  signature?: string;
}

export interface ImportLink {
  filePath: string;
  sourceModule: string;
  importedSymbol: string;
  isDefault: boolean;
  line: number;
}

export interface CallLink {
  filePath: string;
  callerSymbol: string;
  calleeSymbol: string;
  line: number;
}

export interface RouteEndpoint {
  filePath: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL';
  path: string;
  handlerSymbol: string;
  line: number;
}

export interface FileCodeIntelligence {
  filePath: string;
  language: 'typescript' | 'javascript' | 'python' | 'java' | 'other';
  symbols: CodeSymbol[];
  imports: ImportLink[];
  calls: CallLink[];
  routes: RouteEndpoint[];
}

export class ASTCodeParser {
  /**
   * Detects programming language from file extension.
   */
  detectLanguage(filePath: string): FileCodeIntelligence['language'] {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.ts':
      case '.tsx':
      case '.mts':
      case '.cts':
        return 'typescript';
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return 'javascript';
      case '.py':
      case '.pyw':
        return 'python';
      case '.java':
        return 'java';
      default:
        return 'other';
    }
  }

  /**
   * Parses source code to extract symbols, import edges, calls, and routes.
   * Handles LF and CRLF uniformly.
   */
  parseSource(filePath: string, sourceText: string): FileCodeIntelligence {
    const posixPath = normalizeToPosix(filePath);
    const language = this.detectLanguage(posixPath);
    const normalized = sourceText.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');

    switch (language) {
      case 'typescript':
      case 'javascript':
        return this.parseTypeScript(posixPath, lines, language);
      case 'python':
        return this.parsePython(posixPath, lines);
      case 'java':
        return this.parseJava(posixPath, lines);
      default:
        return {
          filePath: posixPath,
          language: 'other',
          symbols: [],
          imports: [],
          calls: [],
          routes: [],
        };
    }
  }

  private parseTypeScript(
    filePath: string,
    lines: string[],
    language: 'typescript' | 'javascript'
  ): FileCodeIntelligence {
    const symbols: CodeSymbol[] = [];
    const imports: ImportLink[] = [];
    const calls: CallLink[] = [];
    const routes: RouteEndpoint[] = [];

    let currentEnclosing: CodeSymbol | null = null;
    let currentMethod: CodeSymbol | null = null;
    let enclosingBraceDepth = 0;
    let methodBraceDepth = 0;
    let currentBraceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const rawLine = lines[i] ?? '';
      const line = rawLine.trim();

      // Track brace depth
      for (const ch of rawLine) {
        if (ch === '{') currentBraceDepth++;
        if (ch === '}') {
          currentBraceDepth--;
          if (currentMethod && currentBraceDepth <= methodBraceDepth) {
            currentMethod.endLine = lineNum;
            currentMethod = null;
          }
          if (currentEnclosing && currentBraceDepth <= enclosingBraceDepth) {
            currentEnclosing.endLine = lineNum;
            currentEnclosing = null;
          }
        }
      }

      if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
        continue;
      }

      // 1. Imports
      // import { a, b } from './module'
      // import DefaultItem from './module'
      const importNamedMatch = line.match(/^import\s+(?:type\s+)?{([^}]+)}\s+from\s+['"]([^'"]+)['"]/);
      if (importNamedMatch) {
        const rawSymbols = importNamedMatch[1]!.split(',');
        const sourceModule = importNamedMatch[2]!;
        for (const s of rawSymbols) {
          const sym = s.trim().split(/\s+as\s+/)[0]!.trim();
          if (sym) {
            imports.push({
              filePath,
              sourceModule,
              importedSymbol: sym,
              isDefault: false,
              line: lineNum,
            });
          }
        }
        continue;
      }

      const importDefaultMatch = line.match(/^import\s+(?:type\s+)?([a-zA-Z0-9_$]+)\s+from\s+['"]([^'"]+)['"]/);
      if (importDefaultMatch) {
        imports.push({
          filePath,
          sourceModule: importDefaultMatch[2]!,
          importedSymbol: importDefaultMatch[1]!,
          isDefault: true,
          line: lineNum,
        });
        continue;
      }

      // 2. Class, Interface, Type
      const classMatch = line.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_$]+)/);
      if (classMatch) {
        const sym: CodeSymbol = {
          name: classMatch[1]!,
          filePath,
          kind: 'class',
          startLine: lineNum,
          endLine: lineNum,
        };
        symbols.push(sym);
        currentEnclosing = sym;
        enclosingBraceDepth = currentBraceDepth - 1;
        continue;
      }

      const interfaceMatch = line.match(/^(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)/);
      if (interfaceMatch) {
        const sym: CodeSymbol = {
          name: interfaceMatch[1]!,
          filePath,
          kind: 'interface',
          startLine: lineNum,
          endLine: lineNum,
        };
        symbols.push(sym);
        continue;
      }

      // 3. Function Declaration
      const funcMatch = line.match(
        /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)/
      );
      if (funcMatch) {
        const sym: CodeSymbol = {
          name: funcMatch[1]!,
          filePath,
          kind: 'function',
          startLine: lineNum,
          endLine: lineNum,
          signature: `function ${funcMatch[1]}(${funcMatch[2] || ''})`,
        };
        symbols.push(sym);
        currentEnclosing = sym;
        enclosingBraceDepth = currentBraceDepth - 1;
        continue;
      }

      // Const arrow function: const myFunc = (args) => ...
      const arrowMatch = line.match(
        /^(?:export\s+)?const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/
      );
      if (arrowMatch) {
        const sym: CodeSymbol = {
          name: arrowMatch[1]!,
          filePath,
          kind: 'function',
          startLine: lineNum,
          endLine: lineNum,
        };
        symbols.push(sym);
        currentEnclosing = sym;
        enclosingBraceDepth = currentBraceDepth - 1;
        continue;
      }

      // Method in class: methodName(params) {
      if (currentEnclosing && currentEnclosing.kind === 'class') {
        const methodMatch = line.match(
          /^(?:public|private|protected|static|async|\*|\s)*\s*([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\s*\{/
        );
        if (
          methodMatch &&
          !['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(methodMatch[1]!)
        ) {
          const sym: CodeSymbol = {
            name: `${currentEnclosing.name}.${methodMatch[1]}`,
            filePath,
            kind: 'method',
            startLine: lineNum,
            endLine: lineNum,
            enclosingSymbol: currentEnclosing.name,
            signature: `${methodMatch[1]}(${methodMatch[2] || ''})`,
          };
          symbols.push(sym);
          currentMethod = sym;
          methodBraceDepth = currentBraceDepth - 1;
        }
      }

      // 4. API Route Detection (Express, Fastify, Next.js / Router)
      // app.get('/path', handler) | router.post('/path', ...)
      const routeMatch = line.match(
        /\b(?:app|router|server|api)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/i
      );
      if (routeMatch) {
        const method = routeMatch[1]!.toUpperCase() as RouteEndpoint['method'];
        const rPath = routeMatch[2]!;
        routes.push({
          filePath,
          method,
          path: rPath,
          handlerSymbol: (currentMethod || currentEnclosing) ? (currentMethod || currentEnclosing)!.name : `${method} ${rPath}`,
          line: lineNum,
        });
      }

      // 5. Calls within current function/method scope
      const activeCaller = currentMethod || currentEnclosing;
      if (activeCaller) {
        // Match calleeName(
        const callMatches = line.matchAll(/\b([a-zA-Z0-9_$]+)\s*\(/g);
        for (const cm of callMatches) {
          const callee = cm[1]!;
          if (!['if', 'for', 'while', 'switch', 'catch', 'function', 'return'].includes(callee)) {
            calls.push({
              filePath,
              callerSymbol: activeCaller.name,
              calleeSymbol: callee,
              line: lineNum,
            });
          }
        }
      }
    }

    // Seal any unclosed symbols to EOF
    for (const sym of symbols) {
      if (sym.endLine === sym.startLine && lines.length > sym.startLine) {
        sym.endLine = Math.min(lines.length, sym.startLine + 25);
      }
    }

    return {
      filePath,
      language,
      symbols,
      imports,
      calls,
      routes,
    };
  }

  private parsePython(filePath: string, lines: string[]): FileCodeIntelligence {
    const symbols: CodeSymbol[] = [];
    const imports: ImportLink[] = [];
    const calls: CallLink[] = [];
    const routes: RouteEndpoint[] = [];

    let currentEnclosing: CodeSymbol | null = null;
    let enclosingIndent = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const rawLine = lines[i] ?? '';
      const line = rawLine.trim();
      const indent = rawLine.search(/\S/);

      if (line.startsWith('#') || line.length === 0) continue;

      if (currentEnclosing && indent <= enclosingIndent) {
        currentEnclosing.endLine = lineNum - 1;
        currentEnclosing = null;
      }

      // from module import symbol
      const fromImportMatch = line.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+(.+)$/);
      if (fromImportMatch) {
        const mod = fromImportMatch[1]!;
        const syms = fromImportMatch[2]!.split(',');
        for (const s of syms) {
          const clean = s.trim().split(/\s+as\s+/)[0]!.trim();
          if (clean) {
            imports.push({
              filePath,
              sourceModule: mod,
              importedSymbol: clean,
              isDefault: false,
              line: lineNum,
            });
          }
        }
        continue;
      }

      // import module
      const importMatch = line.match(/^import\s+([a-zA-Z0-9_.]+)/);
      if (importMatch) {
        imports.push({
          filePath,
          sourceModule: importMatch[1]!,
          importedSymbol: importMatch[1]!,
          isDefault: true,
          line: lineNum,
        });
        continue;
      }

      // class ClassName:
      const classMatch = line.match(/^class\s+([a-zA-Z0-9_]+)/);
      if (classMatch) {
        const sym: CodeSymbol = {
          name: classMatch[1]!,
          filePath,
          kind: 'class',
          startLine: lineNum,
          endLine: lineNum,
        };
        symbols.push(sym);
        currentEnclosing = sym;
        enclosingIndent = indent;
        continue;
      }

      // def func(params):
      const funcMatch = line.match(/^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\):/);
      if (funcMatch) {
        const parentClass = currentEnclosing && currentEnclosing.kind === 'class' ? currentEnclosing.name : null;
        const name = parentClass ? `${parentClass}.${funcMatch[1]}` : funcMatch[1]!;
        const sym: CodeSymbol = {
          name,
          filePath,
          kind: parentClass ? 'method' : 'function',
          startLine: lineNum,
          endLine: lineNum,
          enclosingSymbol: parentClass || undefined,
          signature: `def ${name}(${funcMatch[2] || ''})`,
        };
        symbols.push(sym);
        currentEnclosing = sym;
        enclosingIndent = indent;
        continue;
      }

      // FastAPI / Flask Route: @app.get('/path')
      const pyRouteMatch = line.match(/@(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/i);
      if (pyRouteMatch) {
        routes.push({
          filePath,
          method: pyRouteMatch[1]!.toUpperCase() as RouteEndpoint['method'],
          path: pyRouteMatch[2]!,
          handlerSymbol: currentEnclosing ? currentEnclosing.name : 'handler',
          line: lineNum,
        });
      }

      // Calls
      if (currentEnclosing) {
        const callMatches = line.matchAll(/\b([a-zA-Z0-9_]+)\s*\(/g);
        for (const cm of callMatches) {
          const callee = cm[1]!;
          if (!['def', 'class', 'if', 'for', 'while', 'print', 'return'].includes(callee)) {
            calls.push({
              filePath,
              callerSymbol: currentEnclosing.name,
              calleeSymbol: callee,
              line: lineNum,
            });
          }
        }
      }
    }

    return {
      filePath,
      language: 'python',
      symbols,
      imports,
      calls,
      routes,
    };
  }

  private parseJava(filePath: string, lines: string[]): FileCodeIntelligence {
    const symbols: CodeSymbol[] = [];
    const imports: ImportLink[] = [];
    const calls: CallLink[] = [];
    const routes: RouteEndpoint[] = [];

    let currentClass: CodeSymbol | null = null;
    let currentMethod: CodeSymbol | null = null;

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const rawLine = lines[i] ?? '';
      const line = rawLine.trim();

      if (line.startsWith('//') || line.startsWith('/*')) continue;

      // import package.Class;
      const importMatch = line.match(/^import\s+([a-zA-Z0-9_.]+);/);
      if (importMatch) {
        const full = importMatch[1]!;
        const parts = full.split('.');
        const sym = parts[parts.length - 1]!;
        imports.push({
          filePath,
          sourceModule: full,
          importedSymbol: sym,
          isDefault: true,
          line: lineNum,
        });
        continue;
      }

      // class ClassName
      const classMatch = line.match(/^(?:public\s+|private\s+|protected\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_]+)/);
      if (classMatch) {
        const sym: CodeSymbol = {
          name: classMatch[1]!,
          filePath,
          kind: 'class',
          startLine: lineNum,
          endLine: lineNum,
        };
        symbols.push(sym);
        currentClass = sym;
        continue;
      }

      // Spring Boot Route: @GetMapping("/path")
      const springMatch = line.match(/@(Get|Post|Put|Delete)Mapping\s*\(\s*['"]([^'"]+)['"]/i);
      if (springMatch) {
        routes.push({
          filePath,
          method: springMatch[1]!.toUpperCase() as RouteEndpoint['method'],
          path: springMatch[2]!,
          handlerSymbol: currentMethod ? currentMethod.name : 'endpoint',
          line: lineNum,
        });
      }

      // Method: public ReturnType methodName(args) {
      const methodMatch = line.match(
        /^(?:public|private|protected|static|final|\s)*\s+[a-zA-Z0-9_<>[\]]+\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(?:throws\s+[^{]+)?\s*\{/
      );
      if (methodMatch && !['if', 'for', 'while', 'switch'].includes(methodMatch[1]!)) {
        const methodName = currentClass ? `${currentClass.name}.${methodMatch[1]}` : methodMatch[1]!;
        const sym: CodeSymbol = {
          name: methodName,
          filePath,
          kind: 'method',
          startLine: lineNum,
          endLine: lineNum,
          enclosingSymbol: currentClass?.name,
          signature: `${methodMatch[1]}(${methodMatch[2] || ''})`,
        };
        symbols.push(sym);
        currentMethod = sym;
        continue;
      }

      // Calls
      if (currentMethod) {
        const callMatches = line.matchAll(/\b([a-zA-Z0-9_]+)\s*\(/g);
        for (const cm of callMatches) {
          const callee = cm[1]!;
          if (!['if', 'for', 'while', 'switch', 'super', 'this'].includes(callee)) {
            calls.push({
              filePath,
              callerSymbol: currentMethod.name,
              calleeSymbol: callee,
              line: lineNum,
            });
          }
        }
      }
    }

    return {
      filePath,
      language: 'java',
      symbols,
      imports,
      calls,
      routes,
    };
  }
}
