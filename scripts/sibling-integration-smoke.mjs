#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildProject } from '../src/build.mjs';
import { loadConfig } from '../src/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ESTC = path.resolve(HERE, '..');
const SCRIPTS = path.resolve(ESTC, '..');

const required = {
  espack: path.join(SCRIPTS, 'espack', 'espack-merge.mjs'),
  esmin: path.join(SCRIPTS, 'esmin', 'bin', 'esmin.mjs'),
  esb64: path.join(SCRIPTS, 'esb64', 'dist', 'vendor-esb64-runtime.js'),
  eson: path.join(SCRIPTS, 'eson', 'dist', 'ESON.manifest.json'),
  esarr: path.join(SCRIPTS, 'esarr', 'dist', 'ESARR.manifest.json')
};
const missing = Object.entries(required).filter(([, file]) => !fs.existsSync(file));
if (missing.length) {
  console.log('ESTC sibling integration smoke: SKIP');
  for (const [name, file] of missing) console.log('  missing ' + name + ': ' + file);
  process.exit(0);
}

const live = process.argv.includes('--live');
const launch = process.argv.includes('--launch');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'estc-sibling-integration-'));

try {
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'src', 'main.ts'), [
    'interface RNG { float(min:number,max:number):number; }',
    'var api:any={};',
    'api.float=function(min:number,max:number){return min+max;};',
    'void api;',
    ''
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(tmp, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES5', module: 'None', strict: false }
  }, null, 2) + '\n', 'utf8');

  const configText = 'export default ' + JSON.stringify({
    entry: 'src/main.ts',
    outfile: 'dist/integrated.min.jsx',
    globalName: 'ESTCSiblingIntegration',
    target: 'illustrator',
    tsconfig: 'tsconfig.json',
    espack: {
      root: path.join(SCRIPTS, 'espack'),
      mode: 'merge',
      manifests: [required.eson, required.esarr],
      name: 'estc-sibling-integration',
      manifestOut: 'dist/integrated.espack.json'
    },
    esmin: {
      root: path.join(SCRIPTS, 'esmin'),
      profile: 'conservative',
      keepIntermediate: true
    },
    live,
    liveLaunch: launch
  }, null, 2) + ';\n';
  fs.writeFileSync(path.join(tmp, 'extendscript.config.mjs'), configText, 'utf8');

  const config = await loadConfig({ cwd: tmp });
  const result = await buildProject(config, { live, liveLaunch: launch });

  assert.ok(result.integrations.espack, 'ESPACK integration metadata');
  assert.ok(result.integrations.esmin, 'ESMIN integration metadata');
  assert.equal(result.integrations.espack.mode, 'merge');
  assert.equal(result.integrations.espack.safeRuntimeOverride, true,
    'normal inline ESPACK mode must use the current ESTC-compatible ESB64 runtime');
  assert.equal(result.integrations.esmin.profile, 'conservative');

  const final = fs.readFileSync(result.outfile, 'utf8');
  const intermediate = fs.readFileSync(result.integrations.esminIntermediate, 'utf8');
  assert.ok(final.startsWith('#target illustrator\n'));
  assert.ok(final.length > 0 && intermediate.length > 0);
  assert.notEqual(final, intermediate, 'ESMIN must transform the assembled artifact');

  console.log('ESTC sibling integration smoke: PASS');
  console.log('  ESPACK: v' + result.integrations.espack.version +
    ' ' + result.integrations.espack.mode +
    ', base64=' + result.integrations.espack.base64Mode +
    ', safeRuntimeOverride=' + result.integrations.espack.safeRuntimeOverride);
  console.log('  ESMIN: v' + result.integrations.esmin.version +
    ' ' + result.integrations.esmin.profile +
    ', ' + result.integrations.esmin.beforeBytes + ' -> ' +
    result.integrations.esmin.bytes + ' B (' +
    result.integrations.esmin.reductionPercent.toFixed(2) + '% reduction)');
  console.log('  final: ' + result.bytes + ' B' + (result.live ? ', live parse PASS' : ''));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
