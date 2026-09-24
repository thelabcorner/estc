import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { diagnostic } from './diagnostics.mjs';
import { isEs3Reserved } from './reserved.mjs';

function posOf(sf, node) {
  const p = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { line: p.line + 1, column: p.character + 1 };
}

function add(diags, sf, node, code, message, hint = '', severity = 'error') {
  const p = posOf(sf, node);
  diags.push(diagnostic(severity, code, message, sf.fileName, p.line, p.column, hint));
}

function checkBindingName(name, sf, diags, context) {
  if (ts.isIdentifier(name)) {
    if (isEs3Reserved(name.text)) {
      add(
        diags, sf, name, 'ESTC_TS_RESERVED_IDENTIFIER',
        'ES3 reserved word "' + name.text + '" used as a runtime ' + context,
        'Rename the implementation identifier. Public API property names may remain ergonomic through quoted/bracket properties.'
      );
    }
    return;
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) checkBindingName(element.name, sf, diags, context);
    }
  }
}

function runtimePropertyName(node) {
  if (!node || !node.name) return null;
  return ts.isIdentifier(node.name) ? node.name.text : null;
}

export function lintTypeScriptFiles(filePaths, options = {}) {
  const diagnostics = [];
  const seen = new Set();
  const boundaryEntry = options.entry ? path.resolve(options.entry) : null;
  for (const input of filePaths) {
    const file = path.resolve(input);
    if (seen.has(file) || !/\.(?:ts|tsx|mts|cts)$/.test(file) || file.endsWith('.d.ts')) continue;
    seen.add(file);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const isBoundaryEntry = !boundaryEntry || file === boundaryEntry;

    function visit(node) {
      if (ts.isVariableDeclaration(node)) checkBindingName(node.name, sf, diagnostics, 'variable');
      else if (ts.isParameter(node)) {
        // TypeScript's special `this: Type` pseudo-parameter is erased before JS emit.
        // It is not a runtime binding and therefore cannot violate ExtendScript grammar.
        if (!(ts.isIdentifier(node.name) && node.name.text === 'this')) {
          checkBindingName(node.name, sf, diagnostics, 'parameter');
        }
      }
      else if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
        if (node.name) checkBindingName(node.name, sf, diagnostics, 'function name');
      } else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        if (node.name) checkBindingName(node.name, sf, diagnostics, 'class name');
      } else if (ts.isEnumDeclaration(node)) {
        checkBindingName(node.name, sf, diagnostics, 'enum name');
      } else if (ts.isCatchClause(node) && node.variableDeclaration) {
        checkBindingName(node.variableDeclaration.name, sf, diagnostics, 'catch binding');
      } else if (ts.isImportClause(node)) {
        if (node.name) checkBindingName(node.name, sf, diagnostics, 'import binding');
      } else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node)) {
        if (node.name) checkBindingName(node.name, sf, diagnostics, 'import binding');
      }

      if (ts.isObjectLiteralExpression(node)) {
        for (const prop of node.properties) {
          const n = runtimePropertyName(prop);
          if (n && isEs3Reserved(n)) {
            add(
              diagnostics, sf, prop.name, 'ESTC_TS_RESERVED_OBJECT_KEY',
              'unquoted object-literal key "' + n + '" is reserved by ES3',
              'Write it as a quoted key or attach it afterward with bracket notation: obj[\'' + n + '\'] = ...'
            );
          }
        }
      }

      if (ts.isExportSpecifier(node) && !node.isTypeOnly) {
        const exported = node.name && node.name.text;
        if (exported && isEs3Reserved(exported)) {
          add(
            diagnostics, sf, node.name, 'ESTC_TS_RESERVED_EXPORT',
            'export alias "' + exported + '" is an ES3 reserved word and can become an invalid bundler namespace key',
            isBoundaryEntry
              ? 'Use a safe JSX entry/facade export name, then attach the public property by quoted/bracket notation.'
              : 'This imported module is not the JSX entry boundary; verify the alias is tree-shaken from emitted JSX.',
            isBoundaryEntry ? 'error' : 'warning'
          );
        }
      }

      ts.forEachChild(node, visit);
    }
    visit(sf);
  }
  return {
    ok: diagnostics.every((d) => d.severity !== 'error'),
    diagnostics
  };
}
