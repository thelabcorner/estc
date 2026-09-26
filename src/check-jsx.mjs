import { parse } from 'acorn';
import { diagnostic, lineColumnAt } from './diagnostics.mjs';
import { firstMeaningfulLine, stripAdobeDirectives } from './directives.mjs';
import { isEs3Reserved } from './reserved.mjs';

function maskStringsAndComments(source) {
  const s = String(source);
  let out = '';
  let i = 0;
  let state = 'code';
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { out += '  '; i += 2; state = 'line'; continue; }
      if (c === '/' && n === '*') { out += '  '; i += 2; state = 'block'; continue; }
      if (c === '"') { out += ' '; i++; state = 'double'; continue; }
      if (c === "'") { out += ' '; i++; state = 'single'; continue; }
      out += c; i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { out += '\n'; i++; state = 'code'; }
      else { out += ' '; i++; }
      continue;
    }
    if (state === 'block') {
      if (c === '*' && n === '/') { out += '  '; i += 2; state = 'code'; }
      else { out += c === '\n' ? '\n' : ' '; i++; }
      continue;
    }
    if (state === 'single' || state === 'double') {
      const quote = state === 'single' ? "'" : '"';
      if (c === '\\') {
        out += ' ';
        i++;
        if (i < s.length) { out += s[i] === '\n' ? '\n' : ' '; i++; }
      } else if (c === quote) {
        out += ' '; i++; state = 'code';
      } else {
        out += c === '\n' ? '\n' : ' '; i++;
      }
    }
  }
  return out;
}

// Preserve string literal contents while removing comments. Final ExtendScript
// artifacts can intentionally carry executable child bundles as strings (for
// example, a self-extracting/composed payload that is eval'd later). The normal
// lexical pass masks strings to avoid false positives in data, but packaging
// hazards must also be detected inside those future-executable payloads.
function maskCommentsOnly(source) {
  const s = String(source);
  let out = '';
  let i = 0;
  let state = 'code';
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { out += '  '; i += 2; state = 'line'; continue; }
      if (c === '/' && n === '*') { out += '  '; i += 2; state = 'block'; continue; }
      if (c === '"') { out += c; i++; state = 'double'; continue; }
      if (c === "'") { out += c; i++; state = 'single'; continue; }
      out += c; i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { out += '\n'; i++; state = 'code'; }
      else { out += ' '; i++; }
      continue;
    }
    if (state === 'block') {
      if (c === '*' && n === '/') { out += '  '; i += 2; state = 'code'; }
      else { out += c === '\n' ? '\n' : ' '; i++; }
      continue;
    }
    if (state === 'single' || state === 'double') {
      const quote = state === 'single' ? "'" : '"';
      out += c;
      i++;
      if (c === '\\' && i < s.length) {
        out += s[i];
        i++;
      } else if (c === quote) {
        state = 'code';
      }
    }
  }
  return out;
}

const MISSING_BUILTINS = Object.freeze([
  'Number.isFinite', 'Number.isNaN', 'Array.isArray', 'Array.from', 'Object.assign',
  'Object.keys', 'Object.create', 'Object.defineProperty', 'Object.getOwnPropertyDescriptor',
  'Object.getOwnPropertyNames', 'Object.getPrototypeOf', 'Object.freeze', 'Object.seal',
  'Object.preventExtensions', 'Function.prototype.bind', 'String.prototype.includes'
]);

const CORE_GLOBAL_PATCHES = Object.freeze([
  'Array.isArray',
  'Array.prototype.forEach', 'Array.prototype.map', 'Array.prototype.filter',
  'Array.prototype.every', 'Array.prototype.some', 'Array.prototype.reduce',
  'Array.prototype.reduceRight', 'Array.prototype.indexOf', 'Array.prototype.lastIndexOf',
  'Date.prototype.toJSON', 'Date.prototype.toISOString',
  'Function.prototype.bind',
  'Object.assign', 'Object.keys', 'Object.create', 'Object.defineProperty',
  'Object.getOwnPropertyDescriptor', 'Object.getOwnPropertyNames', 'Object.getPrototypeOf',
  'Object.freeze', 'Object.seal', 'Object.preventExtensions',
  'String.prototype.trim', 'String.prototype.trimLeft', 'String.prototype.trimRight',
  'String.prototype.trimStart', 'String.prototype.trimEnd', 'String.prototype.includes',
  'String.prototype.startsWith', 'String.prototype.endsWith', 'String.prototype.repeat'
]);

function walk(node, visit, parent = null, ancestors = []) {
  if (!node || typeof node !== 'object') return;
  visit(node, parent, ancestors);
  const nextAncestors = ancestors.concat(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, node, nextAncestors);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      walk(value, visit, node, nextAncestors);
    }
  }
}

function memberPath(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type !== 'MemberExpression') return null;
  const base = memberPath(node.object);
  if (!base) return null;
  let prop = null;
  if (!node.computed && node.property && node.property.type === 'Identifier') {
    prop = node.property.name;
  } else if (node.computed && node.property && node.property.type === 'Literal' &&
             typeof node.property.value === 'string') {
    prop = node.property.value;
  }
  return prop ? base + '.' + prop : null;
}

function isFunctionBoundary(node) {
  return !!node && (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

function testProvesFunction(test, path) {
  if (!test) return false;
  if (test.type === 'LogicalExpression' && test.operator === '&&') {
    return testProvesFunction(test.left, path) || testProvesFunction(test.right, path);
  }
  if (test.type !== 'BinaryExpression' ||
      !['===', '=='].includes(test.operator)) return false;

  const pairs = [[test.left, test.right], [test.right, test.left]];
  for (const [left, right] of pairs) {
    if (left && left.type === 'UnaryExpression' && left.operator === 'typeof' &&
        memberPath(left.argument) === path &&
        right && right.type === 'Literal' && right.value === 'function') {
      return true;
    }
  }
  return false;
}

function isSafelyFeatureGuarded(node, path, parent, ancestors) {
  if (parent && parent.type === 'UnaryExpression' && parent.operator === 'typeof' &&
      parent.argument === node) {
    return true;
  }

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestor = ancestors[i];
    const child = i === ancestors.length - 1 ? node : ancestors[i + 1];
    if (isFunctionBoundary(ancestor)) return false;

    if (ancestor.type === 'IfStatement' && ancestor.consequent === child &&
        testProvesFunction(ancestor.test, path)) {
      return true;
    }
    if (ancestor.type === 'ConditionalExpression' && ancestor.consequent === child &&
        testProvesFunction(ancestor.test, path)) {
      return true;
    }
  }
  return false;
}


function maskRegexLiterals(masked, ast) {
  if (!ast) return masked;
  const chars = masked.split('');
  walk(ast, (node) => {
    if (node.type !== 'Literal' || !node.regex ||
        typeof node.start !== 'number' || typeof node.end !== 'number') return;
    for (let i = node.start; i < node.end; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
    }
  });
  return chars.join('');
}

function addBinding(name, target) {
  if (!name) return;
  if (name.type === 'Identifier') {
    target.add(name.name);
    return;
  }
  if (name.type === 'ObjectPattern' || name.type === 'ArrayPattern') {
    for (const item of name.properties || name.elements || []) {
      if (!item) continue;
      if (item.type === 'Property') addBinding(item.value, target);
      else addBinding(item.argument || item, target);
    }
  }
}

function collectHoistedDeclarations(root, target) {
  function scan(node) {
    if (!node || typeof node !== 'object') return;
    if (node !== root && (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression')) {
      if (node.type === 'FunctionDeclaration') addBinding(node.id, target);
      return;
    }
    if (node.type === 'VariableDeclaration') {
      for (const declaration of node.declarations || []) addBinding(declaration.id, target);
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) scan(child);
      } else if (value && typeof value === 'object' && typeof value.type === 'string') {
        scan(value);
      }
    }
  }
  scan(root);
}

function isIdentifierReference(node, parent, key) {
  if (!parent) return true;
  if (parent.type === 'VariableDeclarator' && key === 'id') return false;
  if ((parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression') &&
      (key === 'id' || key === 'params')) return false;
  if (parent.type === 'CatchClause' && key === 'param') return false;
  if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return false;
  if (parent.type === 'Property' && key === 'key' && !parent.computed) return false;
  if (parent.type === 'LabeledStatement' && key === 'label') return false;
  if ((parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && key === 'label') return false;
  return true;
}

function analyzeUnboundIdentifiers(ast) {
  const unbound = new Map();

  function createScope(parent) {
    return { parent, declared: new Set() };
  }

  function resolve(scope, name) {
    for (let current = scope; current; current = current.parent) {
      if (current.declared.has(name)) return true;
    }
    return false;
  }

  function record(node, scope) {
    if (resolve(scope, node.name)) return;
    if (!unbound.has(node.name)) unbound.set(node.name, []);
    unbound.get(node.name).push(node);
  }

  function visit(node, scope, parent = null, key = null) {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'Program') {
      const programScope = createScope(scope);
      collectHoistedDeclarations(node, programScope.declared);
      for (const statement of node.body || []) visit(statement, programScope, node, 'body');
      return;
    }

    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
      const functionScope = createScope(scope);
      if (node.type === 'FunctionExpression') addBinding(node.id, functionScope.declared);
      for (const param of node.params || []) addBinding(param, functionScope.declared);
      if (node.body) collectHoistedDeclarations(node.body, functionScope.declared);
      if (node.body) visit(node.body, functionScope, node, 'body');
      return;
    }

    if (node.type === 'CatchClause') {
      const catchScope = createScope(scope);
      addBinding(node.param, catchScope.declared);
      if (node.body) visit(node.body, catchScope, node, 'body');
      return;
    }

    if (node.type === 'Identifier') {
      if (isIdentifierReference(node, parent, key)) record(node, scope);
      return;
    }

    for (const childKey of Object.keys(node)) {
      if (childKey === 'loc' || childKey === 'start' || childKey === 'end') continue;
      const value = node[childKey];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child === 'object' && typeof child.type === 'string') {
            visit(child, scope, node, childKey);
          }
        }
      } else if (value && typeof value === 'object' && typeof value.type === 'string') {
        visit(value, scope, node, childKey);
      }
    }
  }

  visit(ast, null);
  return unbound;
}

function memberRootIdentifier(node) {
  let current = node;
  while (current && current.type === 'MemberExpression') current = current.object;
  return current && current.type === 'Identifier' ? current : null;
}

function isUnboundMemberRoot(node, unbound) {
  if (!unbound) return true;
  const root = memberRootIdentifier(node);
  if (!root) return true;
  return (unbound.get(root.name) || []).includes(root);
}

function pushUnboundDiagnostics(unbound, file, diagnostics, names, severity, code, message) {
  for (const name of names) {
    const nodes = unbound.get(name) || [];
    for (const node of nodes) {
      diagnostics.push(diagnostic(
        severity, code, message(name), file,
        node.loc.start.line, node.loc.start.column + 1
      ));
    }
  }
}

function pushPatternDiagnostics(masked, file, diagnostics, patterns) {
  for (const rule of patterns) {
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g';
    const re = new RegExp(rule.pattern.source, flags);
    let m;
    while ((m = re.exec(masked))) {
      const pos = lineColumnAt(masked, m.index);
      diagnostics.push(diagnostic(rule.severity, rule.code, rule.message, file, pos.line, pos.column, rule.hint || ''));
      if (m[0].length === 0) re.lastIndex++;
    }
  }
}

export function checkJsxText(text, options = {}) {
  const file = options.file || '<input>';
  const mode = options.mode || 'conservative';
  const target = options.target || 'illustrator';
  const requireTarget = options.requireTarget !== false;
  const allowIncludes = options.allowIncludes === true;
  const allowJson = options.allowJson === true;
  const allowedMissingBuiltins = new Set(options.allowedMissingBuiltins || []);
  const allowedGlobalPatches = new Set(options.allowedGlobalPatches || []);
  const diagnostics = [];
  const source = String(text).replace(/^\uFEFF/, '');
  const first = firstMeaningfulLine(source);
  const stripped = stripAdobeDirectives(source);
  const body = stripped.body;
  const directives = stripped.directives;

  // esbuild's export namespace/CommonJS bridge is not a viable ExtendScript
  // runtime surface. Even when ESTC localizes its ES5 built-ins, the helper
  // semantics still require property descriptors/own-property reflection that
  // legacy Adobe engines do not provide. Reject the helper family itself so a
  // future config cannot silently turn a repaired side-effect entry back into
  // an exported namespace. Scan strings too: ESPACK/ESHTTP-style artifacts may
  // carry code as data and execute it later. The module-helper topology is
  // never allowed, even under an explicit global-patch contract, because it is
  // a structural hazard rather than a single polyfill the project owns.
  const payloadScan = maskCommentsOnly(body);
  pushPatternDiagnostics(payloadScan, file, diagnostics, [
    {
      pattern: /\b(?:__defProp|__getOwnPropDesc|__getOwnPropNames|__export|__copyProps|__toCommonJS)\s*=/,
      severity: 'error',
      code: 'ESTC_ESBUILD_MODULE_HELPER',
      message: 'esbuild export/CommonJS module helper survived into an ExtendScript artifact',
      hint: 'Use an export-free side-effect entrypoint that assembles the public facade explicitly instead of exposing entry-point exports through globalName.'
    },
    {
      pattern: /generated\s+esbuild\s+module\s+helper/i,
      severity: 'error',
      code: 'ESTC_ESBUILD_MODULE_HELPER',
      message: 'localized esbuild module-helper fallback survived into an ExtendScript artifact',
      hint: 'Localization cannot make descriptor/live-binding helpers portable to legacy ExtendScript; remove the exported entry-point namespace.'
    }
  ]);

  // Persistent global polyfills are a separate, contract-governed hazard. The
  // AST/scope-aware walk below (ESTC_GLOBAL_PATCH) already covers unbound
  // real-code mutations and honors allowedGlobalPatches with shadowing
  // awareness. This centralized lexical pass additionally catches the same two
  // most dangerous members when they appear as future-executable payloads
  // inside strings, and provides raw-mode (no-AST) coverage. It honors
  // allowedGlobalPatches so an explicit project polyfill contract is not
  // weakened: a member the project deliberately contracts to install is not
  // re-flagged here, while the esbuild module-helper topology above remains
  // unconditionally rejected.
  const globalPatchRules = [];
  if (!allowedGlobalPatches.has('Object.defineProperty')) {
    globalPatchRules.push({
      pattern: /Object(?:\.defineProperty|\s*\[\s*["']defineProperty["']\s*\])\s*=\s*function\b/,
      severity: 'error',
      code: 'ESTC_EMBEDDED_GLOBAL_PATCH',
      message: 'artifact installs a persistent Object.defineProperty polyfill',
      hint: 'Do not mutate shared Adobe engine built-ins. Use an export-free bundle boundary instead.'
    });
  }
  if (!allowedGlobalPatches.has('Function.prototype.bind')) {
    globalPatchRules.push({
      pattern: /Function\.prototype\.bind\s*=\s*function\b/,
      severity: 'error',
      code: 'ESTC_EMBEDDED_GLOBAL_PATCH',
      message: 'artifact installs a persistent Function.prototype.bind polyfill',
      hint: 'Do not mutate shared Adobe engine built-ins. Keep compatibility helpers bundle-local or remove the module-helper requirement.'
    });
  }
  if (globalPatchRules.length) {
    pushPatternDiagnostics(payloadScan, file, diagnostics, globalPatchRules);
  }

  if (requireTarget) {
    const escapedTarget = target.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
    const re = new RegExp('^\\s*#target\\s+' + escapedTarget + '(?:\\s|$)', 'i');
    if (!re.test(first.text)) {
      diagnostics.push(diagnostic(
        'error', 'ESTC_TARGET',
        'first meaningful line must be #target ' + target,
        file, first.line, 1,
        'File-mode JSX should declare its host before executable code. Set requireTarget:false only for embedded/COM/vendor bundles.'
      ));
    }
  }

  for (const d of directives) {
    if (d.kind === 'include' && !allowIncludes) {
      diagnostics.push(diagnostic(
        'error', 'ESTC_INCLUDE',
        '#include must be resolved before the final distributable bundle',
        file, d.line, 1,
        'Bundle includes during build, or explicitly opt into allowIncludes for raw source inspection.'
      ));
    }
    if (d.kind === 'strict') {
      diagnostics.push(diagnostic(
        'error', 'ESTC_HASH_STRICT',
        '#strict is not allowed in the conservative production profile',
        file, d.line, 1
      ));
    }
  }

  let ast = null;
  if (mode === 'conservative') {
    try {
      ast = parse(body, {
        ecmaVersion: 3,
        sourceType: 'script',
        locations: true,
        allowReserved: false
      });
    } catch (err) {
      diagnostics.push(diagnostic(
        'error',
        'ESTC_ES3_PARSE',
        err.message || String(err),
        file,
        err.loc && err.loc.line ? err.loc.line : 1,
        ((err.loc && typeof err.loc.column === 'number') ? err.loc.column : 0) + 1,
        'This is the conservative ES3 grammar gate. Reserved identifiers such as float/int and ES5+ syntax must not survive emitted JSX.'
      ));
    }
  }

  let masked = maskStringsAndComments(body);
  masked = maskRegexLiterals(masked, ast);
  const unbound = ast ? analyzeUnboundIdentifiers(ast) : null;
  const patterns = [
    { pattern: /=>/, severity: 'error', code: 'ESTC_ARROW', message: 'arrow function survived the build' },
    { pattern: /`/, severity: 'error', code: 'ESTC_TEMPLATE', message: 'template literal survived the build' },
    { pattern: /\?\./, severity: 'error', code: 'ESTC_OPTIONAL_CHAIN', message: 'optional chaining survived the build' },
    { pattern: /\?\?/, severity: 'error', code: 'ESTC_NULLISH', message: 'nullish coalescing survived the build' },
    { pattern: /\b(?:import|export)\b/, severity: 'error', code: 'ESTC_MODULE', message: 'runtime module syntax is not valid in a standalone ExtendScript bundle' },
    { pattern: /\b(?:app\.beginUndoGroup|app\.endUndoGroup|suspendHistory)\b/, severity: 'error', code: 'ESTC_CROSS_HOST', message: 'cross-host undo/history API is not an Illustrator ExtendScript API' },
    { pattern: /\bapp\.keyboardShortcuts\b/, severity: 'error', code: 'ESTC_UNVERIFIED_API', message: 'unverified Illustrator keyboardShortcuts API' },
    { pattern: /\bundefined\b/, severity: 'warning', code: 'ESTC_UNDEFINED', message: 'undefined is writable in ES3; prefer void 0 when identity matters' },
    { pattern: /\b(?:NaN|Infinity)\b/, severity: 'warning', code: 'ESTC_NONFINITE', message: 'non-finite token present; guard serialization and geometry paths' },
    { pattern: /\.\s*(?:forEach|map|filter|every|some|reduce)\s*\(/, severity: 'warning', code: 'ESTC_ARRAY_METHOD', message: 'ES5 array method may be unavailable in ExtendScript; verify receiver or use an ES3 loop' },
    { pattern: /\bapp\.executeMenuCommand\s*\(/, severity: 'warning', code: 'ESTC_MENU_COMMAND', message: 'menu command is state/version-sensitive; validate preconditions and postconditions' },
    { pattern: /\bapp\.doScript\s*\(/, severity: 'warning', code: 'ESTC_ACTION', message: 'Action playback is launch-context-sensitive; validate exact host/version' }
  ];
  // Raw ExtendScript/E4X or already-invalid modern syntax has no conservative
  // AST. Keep lexical fallback diagnostics in that case; valid ES3 uses the
  // scope-aware analysis below so locals named Promise/fetch/etc are not false
  // positives.
  if (!ast) {
    patterns.push(
      { pattern: /\b(?:async|await)\b/, severity: 'error', code: 'ESTC_MODERN_SYNTAX', message: 'modern async syntax survived the build' },
      { pattern: /\brequire\b/, severity: 'error', code: 'ESTC_MODULE', message: 'runtime module loader is not valid in a standalone ExtendScript bundle' },
      { pattern: /\b(?:Promise|Map|Set|WeakMap|WeakSet|Symbol|BigInt)\b/, severity: 'error', code: 'ESTC_MODERN_GLOBAL', message: 'modern JavaScript global is not part of the conservative ExtendScript runtime' },
      { pattern: /\b(?:window|document|fetch|XMLHttpRequest|process|Buffer|__dirname|globalThis|console)\b/, severity: 'error', code: 'ESTC_FOREIGN_GLOBAL', message: 'browser or Node global leaked into host JSX' },
      { pattern: /\b(?:setTimeout|clearTimeout|setInterval|clearInterval)\b/, severity: 'error', code: 'ESTC_TIMER_GLOBAL', message: 'browser timer API is unavailable in ExtendScript' }
    );
    for (const name of MISSING_BUILTINS) {
      if (allowedMissingBuiltins.has(name)) continue;
      const escaped = name.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
      patterns.push({
        pattern: new RegExp('\\b' + escaped + '\\b'),
        severity: 'error',
        code: 'ESTC_MISSING_BUILTIN',
        message: name + ' is absent or version-sensitive in ExtendScript; provide an explicit verified shim or rewrite'
      });
    }
  }
  if (!allowJson && !ast) {
    patterns.push({ pattern: /\bJSON\b/, severity: 'warning', code: 'ESTC_JSON', message: 'JSON global is not universal in ExtendScript; bundle or verify an implementation' });
  }
  pushPatternDiagnostics(masked, file, diagnostics, patterns);

  if (ast) {
    pushUnboundDiagnostics(
      unbound, file, diagnostics,
      ['Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt'],
      'error', 'ESTC_MODERN_GLOBAL',
      (name) => name + ' is not part of the conservative ExtendScript runtime'
    );
    pushUnboundDiagnostics(
      unbound, file, diagnostics,
      ['window', 'document', 'fetch', 'XMLHttpRequest', 'process', 'Buffer', '__dirname', 'globalThis', 'require', 'console'],
      'error', 'ESTC_FOREIGN_GLOBAL',
      (name) => name + ' is a browser/Node runtime dependency leaked into host JSX'
    );
    pushUnboundDiagnostics(
      unbound, file, diagnostics,
      ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
      'error', 'ESTC_TIMER_GLOBAL',
      (name) => name + ' is a browser timer API unavailable in ExtendScript'
    );
    if (!allowJson) {
      pushUnboundDiagnostics(
        unbound, file, diagnostics, ['JSON'], 'warning', 'ESTC_JSON',
        () => 'JSON global is not universal in ExtendScript; bundle or verify an implementation'
      );
    }
  }

  const strictMatch = /^\s*["']use strict["'];/m.exec(body);
  if (strictMatch) {
    const pos = lineColumnAt(body, strictMatch.index);
    diagnostics.push(diagnostic(
      'error', 'ESTC_STRICT',
      'strict-mode directive found in emitted JSX',
      file, pos.line, pos.column,
      'Remove bundler-generated strict directives for the conservative ExtendScript pipeline.'
    ));
  }

  if (ast) {
    walk(ast, (node, parent, ancestors) => {
      if (node.type === 'MemberExpression') {
        const path = memberPath(node);
        const assignmentTarget = !!(
          parent && parent.type === 'AssignmentExpression' && parent.left === node
        );
        if (path && assignmentTarget && CORE_GLOBAL_PATCHES.includes(path) &&
            isUnboundMemberRoot(node, unbound) &&
            !allowedGlobalPatches.has(path)) {
          diagnostics.push(diagnostic(
            'error', 'ESTC_GLOBAL_PATCH',
            'persistent built-in mutation "' + path + '" requires an explicit project contract',
            file, node.loc.start.line, node.loc.start.column + 1,
            'Reusable ExtendScript libraries share a persistent engine. Prefer bundle-local helpers; polyfill libraries must enumerate intentional mutations in allowedGlobalPatches.'
          ));
        }
        if (path && MISSING_BUILTINS.includes(path) &&
            isUnboundMemberRoot(node, unbound) &&
            !assignmentTarget &&
            !allowedMissingBuiltins.has(path) &&
            !isSafelyFeatureGuarded(node, path, parent, ancestors)) {
          diagnostics.push(diagnostic(
            'error', 'ESTC_MISSING_BUILTIN',
            path + ' is absent or version-sensitive in ExtendScript; provide an explicit verified implementation or rewrite',
            file, node.loc.start.line, node.loc.start.column + 1,
            'Bracket notation does not make a missing runtime API available. A typeof feature guard is allowed when a verified fallback exists.'
          ));
        }
      }
      if (node.type === 'Property' && node.key && node.key.type === 'Identifier' && isEs3Reserved(node.key.name)) {
        diagnostics.push(diagnostic(
          'error', 'ESTC_ES3_RESERVED_PROPERTY',
          'unquoted object-literal property "' + node.key.name + '" is reserved in strict ES3',
          file, node.key.loc.start.line, node.key.loc.start.column + 1,
          'Quote the key or let the compatibility re-emitter quote it.'
        ));
      }
      if (node.type === 'MemberExpression' && !node.computed && node.property &&
          node.property.type === 'Identifier' && isEs3Reserved(node.property.name)) {
        diagnostics.push(diagnostic(
          'error', 'ESTC_ES3_RESERVED_DOT_PROPERTY',
          'dot-property name "' + node.property.name + '" is reserved in strict ES3',
          file, node.property.loc.start.line, node.property.loc.start.column + 1,
          'Use bracket access in emitted JSX; TypeScript source may stay ergonomic because the compatibility re-emitter rewrites this form.'
        ));
      }
      if (node.type === 'CallExpression' && node.callee && node.callee.type === 'Identifier' &&
          node.callee.name === 'parseInt' && node.arguments.length < 2) {
        diagnostics.push(diagnostic(
          'warning', 'ESTC_PARSEINT_RADIX',
          'parseInt called without an explicit radix; ES3 may infer octal',
          file, node.loc.start.line, node.loc.start.column + 1,
          'Pass radix 10 unless another radix is intentional.'
        ));
      }
      if (node.type === 'NewExpression' && node.callee && node.callee.type === 'Identifier' &&
          node.callee.name === 'Boolean') {
        diagnostics.push(diagnostic(
          'warning', 'ESTC_BOOLEAN_OBJECT',
          'new Boolean(...) creates an always-truthy wrapper object',
          file, node.loc.start.line, node.loc.start.column + 1
        ));
      }
      if (node.type === 'CallExpression' && node.callee && node.callee.type === 'MemberExpression' &&
          !node.callee.computed && node.callee.property && node.callee.property.name === 'sort' &&
          node.arguments.length === 0) {
        diagnostics.push(diagnostic(
          'warning', 'ESTC_SORT_COMPARATOR',
          'sort() without a comparator is lexicographic and engine-order-sensitive',
          file, node.loc.start.line, node.loc.start.column + 1
        ));
      }
    });
  }

  const errors = diagnostics.filter((d) => d.severity === 'error');
  return {
    ok: errors.length === 0,
    mode,
    parser: mode === 'conservative' ? 'acorn-ecma3' : 'raw-scan',
    directives,
    diagnostics
  };
}
