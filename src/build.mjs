import fs from 'node:fs';
import path from 'node:path';
import { build as esbuild } from 'esbuild';
import UglifyJS from 'uglify-js';
import { checkJsxText } from './check-jsx.mjs';
import { formatDiagnostics } from './diagnostics.mjs';
import { lintTypeScriptFiles } from './lint-ts.mjs';
import { resolveFragments } from './config.mjs';
import { typecheckFiles } from './typecheck.mjs';
import { runLiveParse } from './live.mjs';
import { localizeEsbuildRuntimeHelpers } from './esbuild-compat.mjs';
import { repairExtendScriptSwitches } from './output-compat.mjs';
import { builtInShims } from './shims.mjs';

function stripGeneratedStrict(code) {
  return String(code)
    .replace(/^\s*["']use strict["'];?\s*/g, '')
    .replace(/\n\s*["']use strict["'];?\s*/g, '\n');
}

export function normalizeForExtendScript(code) {
  const result = UglifyJS.minify(String(code), {
    parse: { module: false, html5_comments: false },
    compress: false,
    mangle: false,
    output: {
      extendscript: true,
      ie: true,
      semicolons: true,
      braces: true,
      ascii_only: true,
      keep_quoted_props: true,
      quote_keys: true,
      quote_style: 3,
      comments: false
    }
  });
  if (result.error) throw result.error;
  return repairExtendScriptSwitches(result.code);
}

function projectInputs(metafile, cwd) {
  const out = [];
  for (const input of Object.keys(metafile.inputs || {})) {
    const abs = path.resolve(cwd, input);
    if (abs.includes(path.sep + 'node_modules' + path.sep)) continue;
    if (/\.(?:ts|tsx|mts|cts)$/.test(abs) && !abs.endsWith('.d.ts')) out.push(abs);
  }
  return [...new Set(out)];
}

function throwDiagnostics(label, diagnostics) {
  const err = new Error(label + '\n' + formatDiagnostics(diagnostics));
  err.diagnostics = diagnostics;
  throw err;
}

export async function buildProject(config, options = {}) {
  if (!fs.existsSync(config.entry)) throw new Error('Entry not found: ' + config.entry);

  const result = await esbuild({
    absWorkingDir: config.cwd,
    entryPoints: [config.entry],
    bundle: true,
    write: false,
    metafile: true,
    format: 'iife',
    globalName: config.globalName,
    platform: 'neutral',
    target: ['es5'],
    legalComments: 'none',
    charset: 'ascii',
    logLevel: 'silent',
    sourcemap: false
  });

  const inputs = projectInputs(result.metafile, config.cwd);
  const buildDiagnostics = [];

  if (config.sourceLint !== false) {
    const lint = lintTypeScriptFiles(inputs, config);
    if (!lint.ok) throwDiagnostics('TypeScript ExtendScript-source compatibility failed.', lint.diagnostics);
    buildDiagnostics.push(...lint.diagnostics);
  }

  if (config.typecheck !== false) {
    const typed = typecheckFiles(inputs.length ? inputs : [config.entry], config);
    if (!typed.ok) throwDiagnostics('TypeScript host type-check failed.', typed.diagnostics);
    buildDiagnostics.push(...typed.diagnostics);
  }

  let emitted = result.outputFiles[0].text;
  const transformEvidence = [];
  const transforms = new Set(config.compatibilityTransforms || []);
  for (const name of transforms) {
    if (name !== 'esbuild') throw new Error('Unknown compatibility transform: ' + name);
  }
  if (transforms.has('esbuild')) {
    const localized = localizeEsbuildRuntimeHelpers(emitted);
    emitted = localized.code;
    transformEvidence.push({ name: 'esbuild', changed: localized.changed, counts: localized.counts });
  }

  const prelude = resolveFragments(config.prelude, config.cwd);
  const footer = resolveFragments(config.footer, config.cwd);
  const shims = builtInShims(config.compatibilityShims);
  let body = [...prelude, ...shims, emitted, ...footer].filter(Boolean).join('\n');
  body = stripGeneratedStrict(body);
  if (config.normalize !== false) body = normalizeForExtendScript(body);

  let finalText = body;
  if (config.requireTarget !== false) finalText = '#target ' + config.target + '\n' + body + '\n';

  const checked = checkJsxText(finalText, {
    file: config.outfile,
    mode: 'conservative',
    target: config.target,
    requireTarget: config.requireTarget,
    allowIncludes: config.allowIncludes,
    allowJson: config.allowJson,
    allowedMissingBuiltins: config.allowedMissingBuiltins || [],
    allowedGlobalPatches: config.allowedGlobalPatches || []
  });
  if (!checked.ok) throwDiagnostics('Final JSX compatibility check failed.', checked.diagnostics);
  buildDiagnostics.push(...checked.diagnostics);

  if (config.live || options.live) {
    const live = runLiveParse(finalText, {
      target: config.target,
      launch: config.liveLaunch || options.liveLaunch
    });
    if (!live.ok) {
      const err = new Error('Illustrator live parse failed: ' + (live.error || live.raw || 'unknown error'));
      err.live = live;
      throw err;
    }
  }

  fs.mkdirSync(path.dirname(config.outfile), { recursive: true });
  fs.writeFileSync(config.outfile, finalText, 'utf8');

  return {
    outfile: config.outfile,
    bytes: Buffer.byteLength(finalText),
    inputs,
    diagnostics: buildDiagnostics,
    compatibilityTransforms: transformEvidence,
    live: config.live || options.live ? true : false
  };
}
