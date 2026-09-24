import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildProject, normalizeForExtendScript } from '../src/build.mjs';
import { checkJsxText } from '../src/check-jsx.mjs';
import { loadConfig } from '../src/config.mjs';
import { localizeEsbuildRuntimeHelpers } from '../src/esbuild-compat.mjs';
import { lintTypeScriptFiles } from '../src/lint-ts.mjs';
import { composeEspack, inspectIntegrations, minifyWithEsmin } from '../src/integrations/index.mjs';
import { repairExtendScriptSwitches } from '../src/output-compat.mjs';
import { ES3_RESERVED, reservedData } from '../src/reserved.mjs';
import { auditTypeSources } from '../src/type-audit.mjs';
import { auditWorkspace } from '../src/workspace-audit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures');

function codes(result) {
  return new Set(result.diagnostics.map((d) => d.code));
}

function check(source, options = {}) {
  return checkJsxText(source, {
    file: '<fixture>',
    requireTarget: true,
    ...options
  });
}

test('Adobe sample snapshot integrity and Types-for-Adobe parity inventory are valid', () => {
  const audit = auditTypeSources('Illustrator/2022');
  assert.equal(audit.ok, true);
  assert.equal(audit.adobeSample.integrity, true);
  assert.ok(audit.primary.sourceFiles > 0);
  assert.ok(audit.primary.declarationNames > audit.adobeSample.declarationNames);
  assert.ok(audit.parity.overlapCount > 0);
});

test('workspace manifest audit aggregates artifacts and diagnostic codes without mutation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estc-workspace-'));
  try {
    fs.writeFileSync(path.join(dir, 'clean.js'), 'var x={"float":1};\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      version: 1,
      policy: { mode: 'conservative', requireTarget: false },
      artifacts: [
        { project: 'clean', path: './clean.js' },
        { project: 'missing', path: './missing.js' }
      ]
    }), 'utf8');
    const audit = auditWorkspace(path.join(dir, 'manifest.json'));
    assert.equal(audit.ok, false);
    assert.equal(audit.totals.artifacts, 2);
    assert.equal(audit.totals.passed, 1);
    assert.equal(audit.totals.failed, 1);
    assert.equal(audit.diagnosticCodes.ESTC_WORKSPACE_MISSING, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reserved corpus includes Java-era ES3 future reserved words', () => {
  for (const word of ['float', 'int', 'long', 'double', 'native', 'synchronized', 'transient', 'volatile']) {
    assert.equal(ES3_RESERVED.has(word), true, word);
  }
  assert.equal(reservedData.standard.includes('ECMA-262'), true);
});

test('safe quoted/bracket public API passes strict ES3 gate', () => {
  const source = fs.readFileSync(path.join(FIXTURES, 'good.jsx'), 'utf8');
  const result = check(source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
});

test('runtime reserved variable is rejected', () => {
  const result = check('#target illustrator\nvar float = 1;');
  assert.equal(result.ok, false);
  assert.equal(codes(result).has('ESTC_ES3_PARSE'), true);
});

test('runtime reserved parameter is rejected', () => {
  const result = check('#target illustrator\nfunction f(float){return float;}');
  assert.equal(result.ok, false);
  assert.equal(codes(result).has('ESTC_ES3_PARSE'), true);
});

test('runtime reserved function name is rejected', () => {
  const result = check('#target illustrator\nfunction float(){return 1;}');
  assert.equal(result.ok, false);
  assert.equal(codes(result).has('ESTC_ES3_PARSE'), true);
});

test('unquoted reserved object literal key is rejected', () => {
  const result = check('#target illustrator\nvar x={float:1};');
  assert.equal(result.ok, false);
  assert.equal(codes(result).has('ESTC_ES3_RESERVED_PROPERTY'), true);
});

test('reserved dot property is rejected by strict ES3 grammar', () => {
  const result = check('#target illustrator\nvar x={};x.float;');
  assert.equal(result.ok, false);
  assert.equal(codes(result).has('ESTC_ES3_RESERVED_DOT_PROPERTY'), true);
});

test('bracket and quoted reserved properties remain legal', () => {
  const result = check('#target illustrator\nvar x={"float":1};x["float"];');
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
});

test('raw mode admits ExtendScript-only syntax without claiming ES3 parse compatibility', () => {
  const result = check('#target illustrator\nvar x=<root><a>1</a></root>;', { mode: 'raw' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.parser, 'raw-scan');
});

test('modern and foreign runtime syntax/globals are rejected', () => {
  const result = check('#target illustrator\nvar f=()=>fetch("x");');
  assert.equal(result.ok, false);
  const c = codes(result);
  assert.equal(c.has('ESTC_ES3_PARSE'), true);
  assert.equal(c.has('ESTC_ARROW'), true);
  assert.equal(c.has('ESTC_FOREIGN_GLOBAL'), true);
});

test('runtime-global analysis is lexical-scope aware and ignores regex literal text', () => {
  const local = check([
    '#target illustrator',
    'function f(Promise, fetch){',
    '  var require=function(){return 1;};',
    '  var async=2, console=3;',
    '  var marker=/Promise fetch require console/;',
    '  return Promise+fetch+require()+async+console+String(marker);',
    '}'
  ].join('\n'));
  assert.equal(local.ok, true, JSON.stringify(local.diagnostics, null, 2));

  const leaked = check('#target illustrator\nfunction f(){return fetch("x")+require("y");}');
  assert.equal(leaked.ok, false);
  const leakedCodes = codes(leaked);
  assert.equal(leakedCodes.has('ESTC_FOREIGN_GLOBAL'), true);
});

test('missing ExtendScript built-ins require an explicit allowance/shim contract', () => {
  const source = '#target illustrator\nObject.defineProperty({}, "x", {value:1});';
  const bad = check(source);
  assert.equal(bad.ok, false);
  assert.equal(codes(bad).has('ESTC_MISSING_BUILTIN'), true);
  const allowed = check(source, { allowedMissingBuiltins: ['Object.defineProperty'] });
  assert.equal(allowed.ok, true, JSON.stringify(allowed.diagnostics, null, 2));
});

test('missing-builtin analysis respects shadowed local roots', () => {
  const result = check([
    '#target illustrator',
    'function f(Object){',
    '  return Object.defineProperty({}, "x", {"value":1});',
    '}'
  ].join('\n'));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
});

test('persistent built-in mutation requires an explicit polyfill contract', () => {
  const source = [
    '#target illustrator',
    'if(typeof Function.prototype.bind!=="function"){',
    '  Function.prototype.bind=function(){return this;};',
    '}'
  ].join('\n');
  const rejected = check(source);
  assert.equal(rejected.ok, false);
  assert.equal(codes(rejected).has('ESTC_GLOBAL_PATCH'), true);
  assert.equal(codes(rejected).has('ESTC_MISSING_BUILTIN'), false);

  const approved = check(source, { allowedGlobalPatches: ['Function.prototype.bind'] });
  assert.equal(approved.ok, true, JSON.stringify(approved.diagnostics, null, 2));
});

test('bracket-spelled missing built-ins cannot bypass the conservative gate', () => {
  const bad = check('#target illustrator\nObject["defineProperty"]({}, "x", {"value":1});');
  assert.equal(bad.ok, false);
  assert.equal(codes(bad).has('ESTC_MISSING_BUILTIN'), true);

  const guarded = check([
    '#target illustrator',
    'if(typeof Object["defineProperty"]==="function"){',
    '  Object["defineProperty"]({}, "x", {"value":1});',
    '}'
  ].join('\n'));
  assert.equal(guarded.ok, true, JSON.stringify(guarded.diagnostics, null, 2));
});

test('missing-builtin feature guards do not leak through nested function boundaries', () => {
  const result = check([
    '#target illustrator',
    'var later;',
    'if(typeof Object["defineProperty"]==="function"){',
    '  later=function(){Object["defineProperty"]({}, "x", {"value":1});};',
    '}'
  ].join('\n'));
  assert.equal(result.ok, false);
  assert.equal(codes(result).has('ESTC_MISSING_BUILTIN'), true);
});

test('TypeScript source lint catches runtime reserved identifier/object key/export alias', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estc-lint-'));
  try {
    const file = path.join(dir, 'bad.ts');
    fs.writeFileSync(file, [
      'var float = 1;',
      'var api = { int: 2 };',
      'function floating() { return 1; }',
      'export { floating as long };'
    ].join('\n'));
    const result = lintTypeScriptFiles([file]);
    assert.equal(result.ok, false);
    const c = codes(result);
    assert.equal(c.has('ESTC_TS_RESERVED_IDENTIFIER'), true);
    assert.equal(c.has('ESTC_TS_RESERVED_OBJECT_KEY'), true);
    assert.equal(c.has('ESTC_TS_RESERVED_EXPORT'), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('TypeScript source lint permits ergonomic reserved member access and type-only member names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estc-lint-good-'));
  try {
    const file = path.join(dir, 'good.ts');
    fs.writeFileSync(file, [
      'interface RNG { float(min:number,max:number):number; }',
      'declare var rng: RNG;',
      'var value = rng.float(0, 1);',
      'var api: any = {};',
      'api["float"] = function(a:number,b:number){return a+b;};',
      'void value;'
    ].join('\n'));
    const result = lintTypeScriptFiles([file]);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reserved export alias is only a warning in an imported modern module', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estc-lint-boundary-'));
  try {
    const entry = path.join(dir, 'entry.ts');
    const module = path.join(dir, 'modern.ts');
    fs.writeFileSync(entry, 'import { floating } from "./modern"; void floating;\n');
    fs.writeFileSync(module, 'function floating(){return 1;} export { floating, floating as float };\n');
    const result = lintTypeScriptFiles([entry, module], { entry });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
    const reserved = result.diagnostics.find((d) => d.code === 'ESTC_TS_RESERVED_EXPORT');
    assert.ok(reserved);
    assert.equal(reserved.severity, 'warning');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('compatibility re-emission quotes literal keys and rewrites reserved dot access', () => {
  const out = normalizeForExtendScript('var x={float:1};x.float;');
  assert.match(out, /["']float["']\s*:/);
  assert.match(out, /x\[["']float["']\]/);
  const result = checkJsxText('#target illustrator\n' + out, { file: '<normalized>' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
});

test('compatibility re-emission repairs Illustrator switch parser edge cases', () => {
  const nonEmpty = normalizeForExtendScript('var x=1;switch(x){case 1:x++;break;}');
  assert.match(nonEmpty, /break;\}/);

  const empty = normalizeForExtendScript('var x=1;switch(x){}');
  assert.match(empty, /switch\(x\)\{default:break;\}/);

  const result = checkJsxText('#target illustrator\n' + empty, { file: '<switch-normalized>' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
});

test('switch repair preserves nested headers and existing case-expression evaluation', () => {
  const nested = repairExtendScriptSwitches('switch((x)){case 1:x++}');
  assert.equal(nested, 'switch((x)){case 1:x++;}');

  const labelOnly = repairExtendScriptSwitches('switch(x){case sideEffect():}');
  assert.equal(labelOnly, 'switch(x){case sideEffect():break;}');
  assert.doesNotMatch(labelOnly, /case 0:/);
  assert.doesNotMatch(labelOnly, /default:break;/);

  const blockStatement = 'switch(x){default:{sideEffect()}}';
  assert.equal(repairExtendScriptSwitches(blockStatement), blockStatement);
});

test('switch repair is AST-scoped and does not corrupt strings, regexes, comments, or nested switches', () => {
  const inert = [
    'var text="switch(x){case 1:broken()}";',
    'var re=/switch\\(x\\)\\{case 1:/;',
    '/* switch(fake){case 1:fake()} */',
    'var value=1;'
  ].join('');
  assert.equal(repairExtendScriptSwitches(inert), inert);

  const nested = 'switch(x){case 1:switch(y){case 2:z()}}';
  assert.equal(
    repairExtendScriptSwitches(nested),
    'switch(x){case 1:switch(y){case 2:z();}}'
  );

  const terminalEmpty = 'switch(x){case 1:work();case sideEffect():}';
  const repaired = repairExtendScriptSwitches(terminalEmpty);
  assert.equal(repaired, 'switch(x){case 1:work();case sideEffect():;}');
  assert.equal((repaired.match(/sideEffect\(\)/g) || []).length, 1);
});

test('switch repair is behavior-preserving across side-effectful and nested cases', () => {
  const fixtures = [
    'var log=[];var x=0;switch((log.push("disc"),x)){};',
    'var log=[];var x=1;switch(x){case (log.push("a"),1):case (log.push("b"),2):};',
    'var log=[];var x=2;switch(x){case (log.push("a"),1):case (log.push("b"),2):};',
    'var log=[];var x=2;switch(x){case (log.push("a"),1):log.push("one");break;case (log.push("b"),2):log.push("two")};',
    'var log=[];var x=1;switch(x){case 1:log.push("outer");switch(2){case 2:log.push("inner")}};',
    'var log=[];var x=1;switch(x){case 1:{log.push("block")}};',
    'var log=[];var x=9;switch(x){default:log.push("default");case 1:log.push("fallthrough")};'
  ];

  for (const source of fixtures) {
    const repaired = repairExtendScriptSwitches(source);
    const originalValue = new Function(source + '\nreturn log.join(",");')();
    const repairedValue = new Function(repaired + '\nreturn log.join(",");')();
    assert.equal(repairedValue, originalValue, repaired);
  }
});

test('esbuild helper localization fails closed instead of snapshotting descriptor/live-binding semantics', () => {
  const input = [
    'var __defProp = Object.defineProperty;',
    'var __getOwnPropDesc = Object.getOwnPropertyDescriptor;',
    'var __getOwnPropNames = Object.getOwnPropertyNames;'
  ].join('\n');
  const localized = localizeEsbuildRuntimeHelpers(input);
  assert.equal(localized.changed, true);
  assert.deepEqual(localized.counts, {
    defineProperty: 1,
    getOwnPropertyDescriptor: 1,
    getOwnPropertyNames: 1,
    boundCopyGetter: 0
  });
  assert.doesNotMatch(localized.code, /desc\.get\s*\(\s*\)/);
  assert.match(localized.code, /refusing to approximate descriptor\/live-binding semantics/);

  const makeDefProp = new Function(
    'Object',
    localized.code + '\nreturn __defProp;'
  );

  const unavailable = makeDefProp({});
  assert.throws(
    () => unavailable({}, 'x', { get: function () { return 1; } }),
    /Object\.defineProperty is required/
  );

  const native = makeDefProp(Object);
  let backing = 1;
  const target = {};
  native(target, 'x', { get: function () { return backing; }, enumerable: true });
  assert.equal(target.x, 1);
  backing = 2;
  assert.equal(target.x, 2);
});

test('esbuild bound-copy helper rewrite preserves live copied getters', () => {
  const input = [
    'var __defProp = Object.defineProperty;',
    'var __getOwnPropDesc = Object.getOwnPropertyDescriptor;',
    'var __getOwnPropNames = Object.getOwnPropertyNames;',
    'var __hasOwnProp = Object.prototype.hasOwnProperty;',
    'var __copyProps = function(to, from, except, desc) {',
    '  if (from && typeof from === "object" || typeof from === "function")',
    '    for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {',
    '      key = keys[i];',
    '      if (!__hasOwnProp.call(to, key) && key !== except)',
    '        __defProp(to, key, { get: function(k) { return from[k]; }.bind(null, key), enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });',
    '    }',
    '  return to;',
    '};'
  ].join('\n');
  const localized = localizeEsbuildRuntimeHelpers(input);
  assert.equal(localized.counts.boundCopyGetter, 1);
  assert.doesNotMatch(localized.code, /\.bind\s*\(/);

  const factory = new Function(
    localized.code + '\n' +
    'var source={value:1};var target={};__copyProps(target,source);' +
    'return {source:source,target:target};'
  );
  const pair = factory();
  assert.equal(pair.target.value, 1);
  pair.source.value = 7;
  assert.equal(pair.target.value, 7);
});

test('build fixture completes full static pipeline without mutating host built-ins', async () => {
  const cwd = path.join(FIXTURES, 'build');
  const config = await loadConfig({ cwd });
  const result = await buildProject(config);
  assert.equal(fs.existsSync(result.outfile), true);
  const emitted = fs.readFileSync(result.outfile, 'utf8');
  assert.equal(emitted.startsWith('#target illustrator\n'), true);
  assert.doesNotMatch(emitted, /\.float\b/);
  assert.match(emitted, /\[["']float["']\]/);
  assert.doesNotMatch(emitted, /var\s+[A-Za-z_$][\w$]*\s*=\s*Object\.defineProperty/);
  assert.doesNotMatch(emitted, /var\s+[A-Za-z_$][\w$]*\s*=\s*Object\.getOwnPropertyDescriptor/);
  assert.doesNotMatch(emitted, /var\s+[A-Za-z_$][\w$]*\s*=\s*Object\.getOwnPropertyNames/);
  assert.doesNotMatch(emitted, /\.bind\s*\(/);
  assert.doesNotMatch(emitted, /Object\.defineProperty\s*=/);
  assert.doesNotMatch(emitted, /Function\.prototype\.bind\s*=/);
  assert.equal(result.compatibilityTransforms.length, 1);
  assert.equal(result.compatibilityTransforms[0].name, 'esbuild');
  assert.equal(result.compatibilityTransforms[0].changed, true);
  const checked = checkJsxText(emitted, { file: result.outfile });
  assert.equal(checked.ok, true, JSON.stringify(checked.diagnostics, null, 2));
});


test('ESPACK/ESMIN integration config resolves roots and tool provenance', async () => {
  const cwd = path.join(FIXTURES, 'integration');
  const config = await loadConfig({ cwd });
  assert.ok(config.espack);
  assert.ok(config.esmin);
  assert.equal(config.espack.manifests.length, 2);
  assert.equal(path.isAbsolute(config.espack.manifests[0]), true);
  assert.equal(path.isAbsolute(config.espack.root), true);
  assert.equal(path.isAbsolute(config.esmin.root), true);

  const integrations = inspectIntegrations(config);
  assert.equal(integrations.espack.enabled, true);
  assert.equal(integrations.espack.available, true);
  assert.equal(integrations.espack.version, '9.9.1');
  assert.equal(integrations.espack.mode, 'merge');
  assert.equal(integrations.esmin.enabled, true);
  assert.equal(integrations.esmin.available, true);
  assert.equal(integrations.esmin.version, '8.8.2');
  assert.equal(integrations.esmin.configAvailable, true);
});

test('ESPACK defer-b64 contract fails closed without an explicit shared codec contract', async () => {
  const cwd = path.join(FIXTURES, 'integration');
  const config = await loadConfig({ cwd });
  config.espack = { ...config.espack, sharedBase64: null };
  assert.throws(
    () => composeEspack(config),
    /deferB64 requires espack\.sharedBase64/
  );
});

test('build pipeline composes ESPACK before ESMIN and revalidates the final artifact', async () => {
  const cwd = path.join(FIXTURES, 'integration');
  const dist = path.join(cwd, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  try {
    const config = await loadConfig({ cwd });
    const result = await buildProject(config);

    assert.equal(fs.existsSync(result.outfile), true);
    assert.ok(result.integrations.espack);
    assert.equal(result.integrations.espack.mode, 'merge');
    assert.equal(result.integrations.espack.manifestCount, 2);
    assert.equal(result.integrations.espack.deferB64, true);
    assert.equal(result.integrations.espack.version, '9.9.1');

    assert.ok(result.integrations.esmin);
    assert.equal(result.integrations.esmin.version, '8.8.2');
    assert.equal(result.integrations.esmin.profile, 'conservative');
    assert.equal(result.integrations.esmin.skipIncludes, true);
    assert.ok(result.integrations.esminIntermediate);
    assert.equal(fs.existsSync(result.integrations.esminIntermediate), true);
    assert.equal(fs.existsSync(config.espack.manifestOut), true);

    const emitted = fs.readFileSync(result.outfile, 'utf8');
    const intermediate = fs.readFileSync(result.integrations.esminIntermediate, 'utf8');
    assert.equal(emitted.startsWith('#target illustrator\n'), true);
    assert.match(emitted, /ESTC_SHARED_B64_STUB/);
    assert.match(emitted, /ESPACK_STUB/);
    assert.match(emitted, /ESMIN_STUB/);
    assert.match(emitted, /["']float["']\s*:/);
    assert.doesNotMatch(emitted, /\.float\b/);
    assert.doesNotMatch(intermediate, /ESMIN_STUB/);

    const sharedAt = emitted.indexOf('ESTC_SHARED_B64_STUB');
    const espackAt = emitted.indexOf('ESPACK_STUB');
    const appAt = emitted.indexOf('IntegrationFixture');
    assert.ok(sharedAt >= 0 && espackAt > sharedAt && appAt > espackAt,
      'composition order must be shared base64 -> ESPACK -> consumer bundle');

    const checked = checkJsxText(emitted, { file: result.outfile });
    assert.equal(checked.ok, true, JSON.stringify(checked.diagnostics, null, 2));
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});


test('ESPACK inline mode replaces a stale vendored codec through ESB64_RUNTIME_PATH', async () => {
  const cwd = path.join(FIXTURES, 'integration');
  const config = await loadConfig({ cwd });
  config.espack = {
    ...config.espack,
    deferB64: false,
    sharedBase64: null,
    manifestOut: null,
    esb64Runtime: path.join(FIXTURES, 'tools', 'esb64', 'dist', 'vendor-esb64-runtime.js')
  };
  const result = composeEspack(config);
  assert.equal(result.metadata.base64Mode, 'inline');
  assert.equal(result.metadata.safeRuntimeOverride, true);
  assert.equal(result.metadata.deferB64, false);
  assert.match(result.text, /ESB64_SAFE_RUNTIME_STUB/);
});

test('ESTC-owned ESMIN stage refuses to re-resolve includes from a temporary path', async () => {
  const cwd = path.join(FIXTURES, 'integration');
  const config = await loadConfig({ cwd });
  config.esmin = { ...config.esmin, skipIncludes: false };
  const inspected = inspectIntegrations(config);
  assert.equal(inspected.esmin.configurationValid, false);
  assert.match(inspected.esmin.issues.join('\n'), /skipIncludes=true/);
  assert.throws(
    () => minifyWithEsmin('#target illustrator\nvar x=1;\n', config),
    /requires esmin\.skipIncludes=true/
  );
});


test('ESPACK manifest sidecar is not committed when post-ESMIN validation fails', async () => {
  const cwd = path.join(FIXTURES, 'integration');
  const dist = path.join(cwd, 'dist-transaction');
  fs.rmSync(dist, { recursive: true, force: true });
  try {
    const config = await loadConfig({ cwd });
    config.outfile = path.join(dist, 'rejected.jsx');
    config.espack = {
      ...config.espack,
      manifestOut: path.join(dist, 'rejected.espack.json')
    };
    config.esmin = {
      ...config.esmin,
      config: path.join(FIXTURES, 'tools', 'esmin', 'configs', 'invalid-output.json'),
      profile: null,
      keepIntermediate: false
    };

    await assert.rejects(
      () => buildProject(config),
      /Post-ESMIN JSX compatibility check failed/
    );
    assert.equal(fs.existsSync(config.outfile), false);
    assert.equal(fs.existsSync(config.espack.manifestOut), false);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});


test('ESPACK shared codec cannot silently duplicate an inline runtime', async () => {
  const cwd = path.join(FIXTURES, 'integration');
  const config = await loadConfig({ cwd });
  config.espack = {
    ...config.espack,
    deferB64: false,
    sharedBase64: { code: 'var SHARED_CODEC=1;' },
    manifestOut: null
  };
  const inspected = inspectIntegrations(config);
  assert.equal(inspected.espack.configurationValid, false);
  assert.match(inspected.espack.issues.join('\n'), /conflicts with deferB64=false/);
  assert.throws(
    () => composeEspack(config),
    /sharedBase64 requires deferred-base64 mode/
  );
});


test('ESPACK auto shared-base64 sentinel survives config normalization', async () => {
  const cwd = path.join(FIXTURES, 'integration');
  const config = await loadConfig({
    cwd,
    configPath: 'extendscript.auto.config.mjs'
  });
  assert.equal(config.espack.sharedBase64, 'auto');
  assert.equal(config.espack.deferB64, 'auto');

  const inspected = inspectIntegrations(config);
  assert.equal(inspected.espack.configurationValid, true);
  assert.equal(inspected.espack.deferB64Supported, true);

  const composed = composeEspack(config);
  assert.equal(composed.metadata.deferB64, true);
  assert.equal(composed.metadata.base64Mode, 'shared');
  assert.match(composed.sharedBase64.join('\n'), /ESB64_SAFE_RUNTIME_STUB/);

  const inlineAuto = {
    ...config,
    espack: {
      ...config.espack,
      deferB64: 'auto',
      sharedBase64: null,
      manifestOut: null
    }
  };
  const inline = composeEspack(inlineAuto);
  assert.equal(inline.metadata.deferB64, false);
  assert.equal(inline.metadata.base64Mode, 'inline');
});
