#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildProject } from '../src/build.mjs';
import { checkJsxText } from '../src/check-jsx.mjs';
import { loadConfig } from '../src/config.mjs';
import { formatDiagnostics } from '../src/diagnostics.mjs';
import { lintTypeScriptFiles } from '../src/lint-ts.mjs';
import { runHostProbe, runLiveParse, runReservedProbe } from '../src/live.mjs';
import { reservedData } from '../src/reserved.mjs';
import { auditTypeSources, summarizeTypeAudit } from '../src/type-audit.mjs';
import { resolveTypesForAdobe } from '../src/typecheck.mjs';
import { auditWorkspace, summarizeWorkspaceAudit } from '../src/workspace-audit.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function fail(message, code = 1) {
  console.error(message);
  process.exitCode = code;
}

function usage() {
  console.log([
    'ExtendScript Toolchain (estc)',
    '',
    'Commands:',
    '  estc doctor [--config FILE] [--json]',
    '  estc check FILE [--raw] [--no-target] [--allow-json] [--allow-includes] [--live] [--launch] [--json]',
    '  estc lint-ts FILE... [--json]',
    '  estc audit-types [--config FILE] [--json]',
    '  estc audit-workspace [--manifest FILE] [--live] [--launch] [--out FILE] [--json]',
    '  estc build [--config FILE] [--live] [--launch] [--json]',
    '  estc probe-host [--launch] [--out FILE] [--json]',
    '  estc probe-reserved [--launch] [--out FILE] [--json]',
    '',
    'The normal validation order is: TypeScript host types -> source dialect lint ->',
    'esbuild ES5 bundle -> bundle-local compatibility transforms -> ExtendScript-safe',
    're-emission -> parser-output repair -> strict ES3/static gate -> optional',
    'compile-only live Illustrator parse -> project-specific runtime tests.'
  ].join('\n'));
}

function parseArgs(argv) {
  const positional = [];
  const flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq >= 0) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const key = arg.slice(2);
    if (['config', 'out', 'manifest'].includes(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      flags.set(key, argv[++i]);
    } else {
      flags.set(key, true);
    }
  }
  return { positional, flags };
}

function packageVersion(name) {
  try { return require(name + '/package.json').version; }
  catch { return null; }
}

function printResult(value, json) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

async function doctor(flags) {
  const config = await loadConfig({ cwd: process.cwd(), configPath: flags.get('config') || null });
  const typeFile = resolveTypesForAdobe(config.hostTypes);
  const typeAudit = auditTypeSources(config.hostTypes);
  const info = {
    ok: typeAudit.ok,
    node: process.version,
    platform: process.platform,
    package: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
    dependencies: {
      typescript: packageVersion('typescript'),
      esbuild: packageVersion('esbuild'),
      acorn: packageVersion('acorn'),
      uglifyJs: packageVersion('uglify-js'),
      typesForAdobe: packageVersion('types-for-adobe')
    },
    typeEnvironment: {
      primary: 'types-for-adobe',
      profile: config.hostTypes,
      resolved: typeFile,
      adobeSampleReference: path.join(ROOT, 'vendor', 'adobe-cep', 'ExtendScript.d.ts'),
      adobeSampleIntegrity: typeAudit.adobeSample.integrity,
      parity: summarizeTypeAudit(typeAudit),
      additionalTypes: config.additionalTypes
    },
    grammar: {
      standard: reservedData.standard,
      section: reservedData.section,
      parser: 'Acorn ecmaVersion 3',
      futureReservedCount: reservedData.futureReserved.length
    },
    config: {
      path: config.configPath,
      host: config.host,
      entry: config.entry,
      outfile: config.outfile,
      target: config.target,
      compatibilityTransforms: config.compatibilityTransforms,
      compatibilityShims: config.compatibilityShims,
      live: config.live
    }
  };
  printResult(info, flags.has('json'));
  if (!info.ok) process.exitCode = 1;
}

async function checkCommand(positional, flags) {
  if (!positional[0]) throw new Error('check requires a JSX/JS file');
  const file = path.resolve(positional[0]);
  const text = fs.readFileSync(file, 'utf8');
  const raw = flags.has('raw');
  const result = checkJsxText(text, {
    file,
    mode: raw ? 'raw' : 'conservative',
    requireTarget: !flags.has('no-target'),
    allowJson: flags.has('allow-json'),
    allowIncludes: flags.has('allow-includes')
  });
  if (flags.has('live')) {
    const live = runLiveParse(text, { launch: flags.has('launch') });
    result.live = live;
    if (!live.ok) result.ok = false;
  }
  if (flags.has('json')) {
    printResult(result, true);
  } else {
    if (result.diagnostics.length) console.log(formatDiagnostics(result.diagnostics));
    console.log((result.ok ? 'PASS' : 'FAIL') + ': ' + file + ' [' + result.parser + ']');
    if (result.live) console.log('Live: ' + JSON.stringify(result.live));
  }
  if (!result.ok) process.exitCode = 1;
}

async function lintCommand(positional, flags) {
  if (!positional.length) throw new Error('lint-ts requires at least one TypeScript file');
  const result = lintTypeScriptFiles(positional.map((p) => path.resolve(p)));
  if (flags.has('json')) printResult(result, true);
  else {
    if (result.diagnostics.length) console.log(formatDiagnostics(result.diagnostics));
    console.log((result.ok ? 'PASS' : 'FAIL') + ': TypeScript ExtendScript source lint');
  }
  if (!result.ok) process.exitCode = 1;
}

async function auditTypesCommand(flags) {
  const config = await loadConfig({ cwd: process.cwd(), configPath: flags.get('config') || null });
  const result = auditTypeSources(config.hostTypes);
  if (flags.has('json')) printResult(result, true);
  else {
    const summary = summarizeTypeAudit(result);
    console.log((result.ok ? 'PASS' : 'FAIL') + ': Adobe/Types-for-Adobe declaration provenance audit');
    console.log('  profile: ' + summary.profile);
    console.log('  Adobe sample integrity: ' + (summary.adobeSampleIntegrity ? 'verified' : 'MISMATCH'));
    console.log('  Types-for-Adobe source files: ' + summary.typesForAdobeSourceFiles);
    console.log('  declaration names: Adobe=' + summary.adobeSampleDeclarationNames +
      ', Types-for-Adobe=' + summary.typesForAdobeDeclarationNames +
      ', overlap=' + summary.overlapCount);
    if (summary.adobeOnlySample.length) console.log('  Adobe-only sample: ' + summary.adobeOnlySample.join(', '));
    if (summary.typesForAdobeOnlySample.length) console.log('  Types-for-Adobe-only sample: ' + summary.typesForAdobeOnlySample.join(', '));
  }
  if (!result.ok) process.exitCode = 1;
}

async function auditWorkspaceCommand(flags) {
  const manifest = path.resolve(
    process.cwd(),
    String(flags.get('manifest') || path.join(ROOT, 'projects', 'workspace-audit.json'))
  );
  const result = auditWorkspace(manifest, {
    live: flags.has('live'),
    launch: flags.has('launch')
  });
  if (flags.get('out')) {
    const out = path.resolve(String(flags.get('out')));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n', 'utf8');
    result.outfile = out;
  }
  if (flags.has('json')) {
    printResult(result, true);
  } else {
    const summary = summarizeWorkspaceAudit(result);
    console.log((result.ok ? 'PASS' : 'FAIL') + ': ExtendScript workspace artifact audit');
    console.log('  artifacts: ' + summary.totals.passed + '/' + summary.totals.artifacts + ' pass');
    console.log('  errors: ' + summary.totals.errors + ', warnings: ' + summary.totals.warnings);
    console.log('  diagnostic codes: ' + Object.entries(summary.diagnosticCodes)
      .map(([code, count]) => code + '=' + count).join(', '));
    for (const [project, stats] of Object.entries(summary.projects)) {
      console.log('  ' + project + ': ' + stats.passed + '/' + stats.artifacts +
        ' pass, ' + stats.errors + ' errors, ' + stats.warnings + ' warnings');
    }
    for (const item of result.artifacts) {
      if (item.ok) continue;
      console.log('  FAIL ' + item.project + '/' + item.label + ': ' + item.path);
      const errors = item.diagnostics.filter((d) => d.severity === 'error');
      if (errors.length) console.log(formatDiagnostics(errors));
    }
  }
  if (!result.ok) process.exitCode = 1;
}

async function buildCommand(flags) {
  const config = await loadConfig({ cwd: process.cwd(), configPath: flags.get('config') || null });
  const result = await buildProject(config, {
    live: flags.has('live'),
    liveLaunch: flags.has('launch')
  });
  if (flags.has('json')) printResult(result, true);
  else {
    console.log('PASS: built ' + result.outfile);
    console.log('  bytes: ' + result.bytes);
    console.log('  TypeScript inputs: ' + result.inputs.length);
    console.log('  compatibility transforms: ' + config.compatibilityTransforms.join(', '));
    console.log('  compatibility shims: ' + (config.compatibilityShims.length ? config.compatibilityShims.join(', ') : 'none'));
    console.log('  live parse: ' + (result.live ? 'yes' : 'no'));
    if (result.diagnostics.length) console.log(formatDiagnostics(result.diagnostics));
  }
}

async function probeHost(flags) {
  const result = runHostProbe({ launch: flags.has('launch') });
  if (result.ok && flags.get('out')) {
    const out = path.resolve(String(flags.get('out')));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n', 'utf8');
    result.outfile = out;
  }
  printResult(result, flags.has('json'));
  if (!result.ok) process.exitCode = 1;
}

async function probeReserved(flags) {
  const result = runReservedProbe({ launch: flags.has('launch') });
  if (result.ok && flags.get('out')) {
    const out = path.resolve(String(flags.get('out')));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n', 'utf8');
    result.outfile = out;
  }
  printResult(result, flags.has('json'));
  if (!result.ok) process.exitCode = 1;
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '-h' || argv[0] === '--help' || argv[0] === 'help') {
    usage();
    return;
  }
  const command = argv.shift();
  const parsed = parseArgs(argv);
  try {
    if (command === 'doctor') await doctor(parsed.flags);
    else if (command === 'check') await checkCommand(parsed.positional, parsed.flags);
    else if (command === 'lint-ts') await lintCommand(parsed.positional, parsed.flags);
    else if (command === 'audit-types') await auditTypesCommand(parsed.flags);
    else if (command === 'audit-workspace') await auditWorkspaceCommand(parsed.flags);
    else if (command === 'build') await buildCommand(parsed.flags);
    else if (command === 'probe-host') await probeHost(parsed.flags);
    else if (command === 'probe-reserved') await probeReserved(parsed.flags);
    else {
      usage();
      fail('Unknown command: ' + command, 2);
    }
  } catch (err) {
    if (parsed.flags.has('json')) {
      console.error(JSON.stringify({
        ok: false,
        error: err && err.message ? err.message : String(err),
        diagnostics: err && err.diagnostics ? err.diagnostics : undefined,
        live: err && err.live ? err.live : undefined
      }, null, 2));
    } else {
      fail('FAIL: ' + (err && err.message ? err.message : String(err)));
    }
  }
}

await main();
