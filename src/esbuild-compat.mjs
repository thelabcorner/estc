/**
 * Rewrite the small ES5-only runtime helper surface emitted by the pinned
 * esbuild IIFE formatter into bundle-local ES3/ExtendScript-compatible helpers.
 *
 * This intentionally does NOT patch Object or Function.prototype. ExtendScript
 * engines are persistent, so mutating built-in globals from a reusable library
 * can leak across unrelated scripts for the rest of the host session.
 */

const IDENT = '[A-Za-z_$][\\w$]*';

function replaceAlias(source, member, factory) {
  const re = new RegExp(
    'var\\s+(' + IDENT + ')\\s*=\\s*' +
    member.replace(/[.*+?^$(){}|[\\]\\\\]/g, '\\$&') +
    '\\s*;',
    'g'
  );
  let count = 0;
  const code = source.replace(re, (_whole, name) => {
    count++;
    return 'var ' + name + ' = ' + factory(name) + ';';
  });
  return { code, count };
}

function localDefineProperty() {
  return [
    'function (obj, prop, desc) {',
    '  if (typeof Object["defineProperty"] === "function") {',
    '    return Object["defineProperty"](obj, prop, desc);',
    '  }',
    '  throw new Error("ESTC: Object.defineProperty is required by the generated esbuild module helper; refusing to approximate descriptor/live-binding semantics.");',
    '}'
  ].join(String.fromCharCode(10));
}

function localGetOwnPropertyDescriptor() {
  return [
    'function (obj, prop) {',
    '  if (typeof Object["getOwnPropertyDescriptor"] === "function") {',
    '    return Object["getOwnPropertyDescriptor"](obj, prop);',
    '  }',
    '  throw new Error("ESTC: Object.getOwnPropertyDescriptor is required by the generated esbuild module helper; refusing to approximate descriptor semantics.");',
    '}'
  ].join(String.fromCharCode(10));
}

function localGetOwnPropertyNames() {
  return [
    'function (obj) {',
    '  if (typeof Object["getOwnPropertyNames"] === "function") {',
    '    return Object["getOwnPropertyNames"](obj);',
    '  }',
    '  throw new Error("ESTC: Object.getOwnPropertyNames is required by the generated esbuild module helper; refusing to approximate own-property enumeration semantics.");',
    '}'
  ].join(String.fromCharCode(10));
}

function rewriteBoundCopyGetter(source) {
  // esbuild 0.28.x emits this in __copyProps:
  //   get: function(k) { return from[k]; }.bind(null, key)
  //
  // Replace only that generated shape. The IIFE preserves the exact one-bound-
  // argument semantics needed by the generated getter without relying on ES5
  // Function.prototype.bind.
  const re = new RegExp(
    'function\\s*\\(\\s*(' + IDENT + ')\\s*\\)\\s*\\{' +
    '\\s*return\\s+(' + IDENT + ')\\s*\\[\\s*\\1\\s*\\]\\s*;?\\s*\\}' +
    '\\s*\\.bind\\s*\\(\\s*null\\s*,\\s*(' + IDENT + ')\\s*\\)',
    'g'
  );
  let count = 0;
  const code = source.replace(re, (_whole, parameter, fromName, keyName) => {
    count++;
    return [
      '(function (fn, arg) {',
      '  return function () { return fn(arg); };',
      '})(function (' + parameter + ') { return ' + fromName + '[' + parameter + ']; }, ' + keyName + ')'
    ].join(' ');
  });
  return { code, count };
}

function generatedHazards(source) {
  const hazards = [];
  const aliases = [
    ['Object.defineProperty', new RegExp('var\\s+' + IDENT + '\\s*=\\s*Object\\.defineProperty\\s*;')],
    ['Object.getOwnPropertyDescriptor', new RegExp('var\\s+' + IDENT + '\\s*=\\s*Object\\.getOwnPropertyDescriptor\\s*;')],
    ['Object.getOwnPropertyNames', new RegExp('var\\s+' + IDENT + '\\s*=\\s*Object\\.getOwnPropertyNames\\s*;')]
  ];
  for (const [name, re] of aliases) if (re.test(source)) hazards.push(name);
  if (/function\s*\([^)]*\)\s*\{[\s\S]{0,160}?\}\.bind\s*\(\s*null\s*,/.test(source)) {
    hazards.push('Function.prototype.bind generated getter');
  }
  return hazards;
}

export function localizeEsbuildRuntimeHelpers(input) {
  let code = String(input);
  const counts = {
    defineProperty: 0,
    getOwnPropertyDescriptor: 0,
    getOwnPropertyNames: 0,
    boundCopyGetter: 0
  };

  let step = replaceAlias(code, 'Object.defineProperty', localDefineProperty);
  code = step.code;
  counts.defineProperty += step.count;

  step = replaceAlias(code, 'Object.getOwnPropertyDescriptor', localGetOwnPropertyDescriptor);
  code = step.code;
  counts.getOwnPropertyDescriptor += step.count;

  step = replaceAlias(code, 'Object.getOwnPropertyNames', localGetOwnPropertyNames);
  code = step.code;
  counts.getOwnPropertyNames += step.count;

  step = rewriteBoundCopyGetter(code);
  code = step.code;
  counts.boundCopyGetter += step.count;

  const hazards = generatedHazards(code);
  if (hazards.length) {
    throw new Error(
      'Unsupported esbuild helper shape survived ExtendScript localization: ' +
      hazards.join(', ') +
      '. The esbuild version or helper preamble likely changed; update the transform before shipping.'
    );
  }

  return {
    code,
    changed: Object.values(counts).some((value) => value > 0),
    counts
  };
}
