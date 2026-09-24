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
import { composeEspack, minifyWithEsmin } from './integrations/index.mjs';

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

function checkFinalText(text, config, label) {
  const checked = checkJsxText(text, {
    file: config.outfile,
    mode: 'conservative',
    target: config.target,
    requireTarget: config.requireTarget,
    allowIncludes: config.allowIncludes,
    allowJson: config.allowJson,
    allowedMissingBuiltins: config.allowedMissingBuiltins || [],
    allowedGlobalPatches: config.allowedGlobalPatches || []
  });
  if (!checked.ok) throwDiagnostics(label, checked.diagnostics);
  return checked;
}

function defaultIntermediatePath(outfile) {
  const ext = path.extname(outfile);
  if (!ext) return outfile + '.unminified';
  return outfile.slice(0, -ext.length) + '.unminified' + ext;
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
  const espack = composeEspack(config);
  const espackParts = espack ? [...espack.sharedBase64, espack.text] : [];

  // Canonical composition order:
  //   project prelude -> ESTC shims -> optional shared ESB64 -> ONE ESPACK loader
  //   -> TypeScript consumer/facade bundle -> footer.
  // ESPACK therefore composes before ESMIN, matching ESPACK's documented
  // pre-minify/pre-obfuscate contract.
  let body = [...prelude, ...shims, ...espackParts, emitted, ...footer].filter(Boolean).join('\n');
  body = stripGeneratedStrict(body);
  if (config.normalize !== false) body = normalizeForExtendScript(body);

  let preDistributionText = body;
  if (config.requireTarget !== false) preDistributionText = '#target ' + config.target + '\n' + body + '\n';

  // Validate ESTC's own artifact before handing it to a downstream minifier.
  const preDistributionCheck = checkFinalText(
    preDistributionText,
    config,
    'Pre-distribution JSX compatibility check failed.'
  );

  const integrations = {
    espack: espack ? espack.metadata : null,
    esmin: null
  };

  let finalText = preDistributionText;
  if (config.esmin) {
    if (config.esmin.keepIntermediate) {
      const intermediate = config.esmin.intermediateOutfile || defaultIntermediatePath(config.outfile);
      fs.mkdirSync(path.dirname(intermediate), { recursive: true });
      fs.writeFileSync(intermediate, preDistributionText, 'utf8');
      integrations.esminIntermediate = intermediate;
    }

    const minified = minifyWithEsmin(preDistributionText, config);
    finalText = minified.text;
    integrations.esmin = minified.metadata;

    // ESMIN is a transformation boundary, not a trust boundary. Re-run ESTC's
    // strict ES3/host gate on the actual distributable bytes.
    const finalCheck = checkFinalText(
      finalText,
      config,
      'Post-ESMIN JSX compatibility check failed.'
    );
    buildDiagnostics.push(...finalCheck.diagnostics);
  } else {
    buildDiagnostics.push(...preDistributionCheck.diagnostics);
  }

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

  // ESPACK sidecars are staged inside the integration adapter and are only
  // committed after every downstream transformation, static gate, and
  // optional live parse has succeeded. A rejected build therefore cannot
  // leave a fresh manifest advertising a final artifact that ESTC refused.
  if (espack && espack.manifest) {
    fs.mkdirSync(path.dirname(espack.manifest.path), { recursive: true });
    fs.writeFileSync(espack.manifest.path, espack.manifest.text, 'utf8');
  }

  return {
    outfile: config.outfile,
    bytes: Buffer.byteLength(finalText),
    bytesBeforeMinify: Buffer.byteLength(preDistributionText),
    inputs,
    diagnostics: buildDiagnostics,
    compatibilityTransforms: transformEvidence,
    integrations,
    live: config.live || options.live ? true : false
  };
}
