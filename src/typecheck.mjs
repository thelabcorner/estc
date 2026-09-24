import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { diagnostic } from './diagnostics.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ES3_CORE_TYPES = path.resolve(HERE, '..', 'types', 'extendscript-es3-core.d.ts');

export function resolveTypesForAdobe(profile = 'Illustrator/2022') {
  const pkg = require.resolve('types-for-adobe/package.json');
  const root = path.dirname(pkg);
  const typeFile = path.join(root, profile, 'index.d.ts');
  if (!fs.existsSync(typeFile)) throw new Error('Types-for-Adobe profile not found: ' + profile);
  return typeFile;
}

function tsDiagnosticToEstc(d) {
  const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  if (d.file && typeof d.start === 'number') {
    const p = d.file.getLineAndCharacterOfPosition(d.start);
    return diagnostic(
      d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
      'TS' + d.code,
      msg,
      d.file.fileName,
      p.line + 1,
      p.character + 1
    );
  }
  return diagnostic(
    d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
    'TS' + d.code,
    msg,
    '<typescript>',
    1,
    1
  );
}

export function typecheckFiles(filePaths, config) {
  let inherited = {};
  if (config.tsconfig && fs.existsSync(config.tsconfig)) {
    const read = ts.readConfigFile(config.tsconfig, ts.sys.readFile);
    if (read.error) return { ok: false, diagnostics: [tsDiagnosticToEstc(read.error)] };
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(config.tsconfig));
    inherited = parsed.options;
  }

  const compilerOptions = {
    ...inherited,
    noEmit: true,
    noLib: true,
    lib: undefined,
    types: [],
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.ESNext,
    moduleResolution: inherited.moduleResolution || ts.ModuleResolutionKind.Node10,
    skipLibCheck: true,
    strict: inherited.strict !== false,
    noImplicitAny: inherited.noImplicitAny !== false
  };

  const roots = [...new Set(filePaths.map((p) => path.resolve(p)))];
  if (config.hostTypes !== false) roots.push(resolveTypesForAdobe(config.hostTypes));
  roots.push(ES3_CORE_TYPES);
  for (const p of config.additionalTypes || []) roots.push(path.resolve(p));

  const program = ts.createProgram({ rootNames: roots, options: compilerOptions });
  const raw = ts.getPreEmitDiagnostics(program);
  const diagnostics = raw.map(tsDiagnosticToEstc);
  return {
    ok: diagnostics.every((d) => d.severity !== 'error'),
    diagnostics,
    rootNames: roots
  };
}
