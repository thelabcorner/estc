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
  espack: null,
  esmin: null,
  live: false,
  liveLaunch: false
});

function merge(base, extra) {
  return { ...base, ...(extra || {}) };
}

function enabledObject(value, name) {
  if (!value || value === false) return null;
  if (value === true) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(name + ' must be false, true, or an options object.');
  }
  if (value.enabled === false) return null;
  return { ...value };
}

function resolveEmbed(base, value) {
  if (typeof value === 'string') {
    var eq = value.lastIndexOf('=');
    var raw = value;
    var suffix = '';
    if (eq > 1 && eq < value.length - 1) {
      raw = value.slice(0, eq);
      suffix = value.slice(eq);
    }
    return path.resolve(base, raw) + suffix;
  }
  if (value && typeof value === 'object' && value.path) {
    return { ...value, path: path.resolve(base, value.path) };
  }
  return value;
}

function normalizeEspack(value, base) {
  const out = enabledObject(value, 'espack');
  if (!out) return null;
  if (out.root) out.root = path.resolve(base, out.root);
  if (out.esb64Root) out.esb64Root = path.resolve(base, out.esb64Root);
  if (typeof out.esb64Runtime === 'string') out.esb64Runtime = path.resolve(base, out.esb64Runtime);
  out.manifests = (Array.isArray(out.manifests) ? out.manifests : [out.manifests].filter(Boolean))
    .map((p) => path.resolve(base, p));
  out.embeds = (Array.isArray(out.embeds) ? out.embeds : [out.embeds].filter(Boolean))
    .map((p) => resolveEmbed(base, p));
  if (typeof out.accel === 'string') out.accel = path.resolve(base, out.accel);
  if (out.manifestOut) out.manifestOut = path.resolve(base, out.manifestOut);
  if (out.sharedBase64 && out.sharedBase64 !== true && out.sharedBase64 !== 'auto') {
    const fragments = Array.isArray(out.sharedBase64) ? out.sharedBase64 : [out.sharedBase64];
    out.sharedBase64 = fragments.map((item) => {
      if (item && typeof item === 'object' && item.file) return { ...item, file: path.resolve(base, item.file) };
      return item;
    });
  }
  return out;
}

function normalizeEsmin(value, base) {
  const out = enabledObject(value, 'esmin');
  if (!out) return null;
  if (out.root) out.root = path.resolve(base, out.root);
  if (out.config) out.config = path.resolve(base, out.config);
  if (out.intermediateOutfile) out.intermediateOutfile = path.resolve(base, out.intermediateOutfile);
  if (!out.profile && !out.config) out.profile = 'conservative';
  if (out.skipIncludes === undefined) out.skipIncludes = true;
  return out;
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
  config.espack = normalizeEspack(config.espack, base);
  config.esmin = normalizeEsmin(config.esmin, base);
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
