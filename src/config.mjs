import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_CONFIG = Object.freeze({
  host: 'illustrator',
  hostTypes: 'Illustrator/2022',
  entry: 'src/index.ts',
  outfile: 'dist/script.jsx',
  globalName: undefined,
  target: 'illustrator',
  requireTarget: true,
  normalize: true,
  sourceLint: true,
  typecheck: true,
  tsconfig: 'tsconfig.json',
  additionalTypes: [],
  compatibilityTransforms: ['esbuild'],
  compatibilityShims: [],
  allowedMissingBuiltins: [],
  allowedGlobalPatches: [],
  prelude: [],
  footer: [],
  allowJson: false,
  allowIncludes: false,
  live: false,
  liveLaunch: false
});

function merge(base, extra) {
  return { ...base, ...(extra || {}) };
}

export async function loadConfig(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const explicit = options.configPath ? path.resolve(cwd, options.configPath) : null;
  const candidate = explicit || path.join(cwd, 'extendscript.config.mjs');
  let user = {};
  let configPath = null;
  if (fs.existsSync(candidate)) {
    const mod = await import(pathToFileURL(candidate).href + '?v=' + fs.statSync(candidate).mtimeMs);
    user = mod.default || mod.config || {};
    configPath = candidate;
  } else if (explicit) {
    throw new Error('Config file not found: ' + candidate);
  }
  const config = merge(DEFAULT_CONFIG, user);
  const base = configPath ? path.dirname(configPath) : cwd;
  config.cwd = base;
  config.configPath = configPath;
  config.entry = path.resolve(base, config.entry);
  config.outfile = path.resolve(base, config.outfile);
  config.tsconfig = config.tsconfig ? path.resolve(base, config.tsconfig) : null;
  config.additionalTypes = (config.additionalTypes || []).map((p) => path.resolve(base, p));
  config.compatibilityTransforms = Array.isArray(config.compatibilityTransforms) ? config.compatibilityTransforms : [config.compatibilityTransforms].filter(Boolean);
  config.compatibilityShims = Array.isArray(config.compatibilityShims) ? config.compatibilityShims : [config.compatibilityShims].filter(Boolean);
  config.allowedMissingBuiltins = Array.isArray(config.allowedMissingBuiltins) ? config.allowedMissingBuiltins : [config.allowedMissingBuiltins].filter(Boolean);
  config.allowedGlobalPatches = Array.isArray(config.allowedGlobalPatches) ? config.allowedGlobalPatches : [config.allowedGlobalPatches].filter(Boolean);
  config.prelude = Array.isArray(config.prelude) ? config.prelude : [config.prelude];
  config.footer = Array.isArray(config.footer) ? config.footer : [config.footer];
  return config;
}

export function resolveFragments(items, cwd) {
  const out = [];
  for (const item of items || []) {
    if (!item) continue;
    if (typeof item === 'object' && item.file) {
      out.push(fs.readFileSync(path.resolve(cwd, item.file), 'utf8'));
    } else if (typeof item === 'object' && typeof item.code === 'string') {
      out.push(item.code);
    } else if (typeof item === 'string') {
      out.push(item);
    }
  }
  return out;
}
