import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveToolRoot, runNodeTool, toolSummary } from './tool-resolver.mjs';

function resolveRoot(config) {
  return resolveToolRoot({
    explicitRoot: config.espack && config.espack.root,
    envName: 'ESPACK_ROOT',
    packageName: 'espack',
    siblingName: 'espack',
    projectCwd: config.cwd,
    requiredFiles: ['espack-build.mjs', 'espack-merge.mjs', 'package.json']
  });
}

function resolveEsb64Runtime(config, opts) {
  if (opts.esb64Runtime === false) return null;
  if (typeof opts.esb64Runtime === 'string') {
    return fs.existsSync(opts.esb64Runtime) ? path.resolve(opts.esb64Runtime) : null;
  }
  if (process.env.ESB64_RUNTIME_PATH && fs.existsSync(process.env.ESB64_RUNTIME_PATH)) {
    return path.resolve(process.env.ESB64_RUNTIME_PATH);
  }
  const root = resolveToolRoot({
    explicitRoot: opts.esb64Root,
    envName: 'ESB64_ROOT',
    packageName: 'esb64',
    siblingName: 'esb64',
    projectCwd: config.cwd,
    requiredFiles: ['dist/vendor-esb64-runtime.js']
  });
  return root ? path.join(root, 'dist', 'vendor-esb64-runtime.js') : null;
}

function embedSpec(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || !value.path) {
    throw new Error('ESTC ESPACK embed entries must be paths or { path, version } objects.');
  }
  return String(value.path) + (value.version === undefined ? '' : '=' + String(value.version));
}

function rejectDirectives(text, label) {
  if (/^\s*#(?:target|targetengine|include|includepath|strict)\b/m.test(text)) {
    throw new Error('ESTC ESPACK integration expected a body fragment without Adobe directives: ' + label);
  }
}

function supportsFlag(root, entry, flag) {
  try {
    return fs.readFileSync(path.join(root, entry), 'utf8').includes(flag);
  } catch {
    return false;
  }
}

function sharedBase64Fragments(espack, cwd, autoRuntime) {
  if (!espack || espack.sharedBase64 === true || !espack.sharedBase64) return [];

  if (espack.sharedBase64 === 'auto') {
    if (!autoRuntime || !fs.existsSync(autoRuntime)) {
      throw new Error('ESTC espack.sharedBase64="auto" could not resolve an ESTC-compatible ESB64 runtime. Set espack.esb64Runtime, ESB64_RUNTIME_PATH, install esb64, or place it in a sibling esb64/ directory.');
    }
    const text = fs.readFileSync(autoRuntime, 'utf8');
    rejectDirectives(text, autoRuntime);
    return [text];
  }

  const value = espack.sharedBase64;
  const items = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of items) {
    let text;
    let label = '<inline sharedBase64>';
    if (typeof item === 'object' && item.file) {
      const file = path.resolve(cwd, item.file);
      label = file;
      text = fs.readFileSync(file, 'utf8');
    } else if (typeof item === 'object' && typeof item.code === 'string') {
      text = item.code;
    } else if (typeof item === 'string') {
      text = item;
    } else {
      throw new Error('ESTC espack.sharedBase64 must be true, "auto", code, a {file} fragment, or an array of fragments.');
    }
    rejectDirectives(text, label);
    out.push(text);
  }
  return out;
}

function integrationMode(opts) {
  return opts.mode || (opts.manifests && opts.manifests.length ? 'merge' : 'build');
}

export function inspectEspack(config) {
  if (!config.espack) return {
    enabled: false,
    available: false,
    configurationValid: true,
    issues: []
  };

  const opts = config.espack;
  const root = resolveRoot(config);
  const mode = integrationMode(opts);
  const entry = mode === 'merge' ? 'espack-merge.mjs' : 'espack-build.mjs';
  const esb64Runtime = resolveEsb64Runtime(config, opts);
  const deferB64Supported = !!(root && supportsFlag(root, entry, '--defer-b64'));
  const hasSharedContract = opts.sharedBase64 !== undefined &&
    opts.sharedBase64 !== null &&
    opts.sharedBase64 !== false;
  const issues = [];

  if (!root) {
    issues.push('ESPACK tool could not be resolved.');
  } else {
    if (opts.deferB64 === false && hasSharedContract) {
      issues.push('sharedBase64 conflicts with deferB64=false.');
    }
    if ((opts.deferB64 === true || hasSharedContract) && !deferB64Supported) {
      issues.push('deferred/shared mode requires ESPACK --defer-b64 support.');
    }
    if (opts.deferB64 === true && !hasSharedContract) {
      issues.push('deferB64=true requires a sharedBase64 contract.');
    }
    if (opts.sharedBase64 === 'auto' && !esb64Runtime) {
      issues.push('sharedBase64="auto" could not resolve an ESB64 runtime.');
    }
  }

  return {
    enabled: true,
    ...toolSummary(root),
    mode,
    deferB64: opts.deferB64 || false,
    deferB64Supported,
    esb64Runtime,
    safeRuntimeOverride: !!esb64Runtime,
    configurationValid: issues.length === 0,
    issues
  };
}

export function composeEspack(config) {
  const opts = config.espack;
  if (!opts) return null;

  const root = resolveRoot(config);
  if (!root) {
    throw new Error('ESTC ESPACK integration is enabled, but ESPACK could not be resolved. Set espack.root, ESPACK_ROOT, install espack, or place it in a sibling espack/ directory.');
  }

  const manifests = opts.manifests || [];
  const embeds = opts.embeds || [];
  const mode = integrationMode(opts);
  if (mode !== 'merge' && mode !== 'build') throw new Error('ESTC espack.mode must be "merge" or "build".');
  if (mode === 'merge' && !manifests.length) throw new Error('ESTC ESPACK merge mode requires espack.manifests.');
  if (mode === 'merge' && embeds.length) throw new Error('ESTC ESPACK merge mode cannot also specify espack.embeds.');
  if (mode === 'build' && manifests.length) throw new Error('ESTC ESPACK build mode cannot also specify espack.manifests.');

  const entry = mode === 'merge' ? 'espack-merge.mjs' : 'espack-build.mjs';
  const autoRuntime = resolveEsb64Runtime(config, opts);
  const shared = sharedBase64Fragments(opts, config.cwd, autoRuntime);
  const hasSharedContract = opts.sharedBase64 !== undefined &&
    opts.sharedBase64 !== null &&
    opts.sharedBase64 !== false;
  const deferSupported = supportsFlag(root, entry, '--defer-b64');

  if (opts.deferB64 === false && hasSharedContract) {
    throw new Error('ESTC espack.sharedBase64 requires deferred-base64 mode. Remove sharedBase64 or allow deferB64 so ESTC can activate --defer-b64.');
  }
  if ((opts.deferB64 === true || hasSharedContract) && !deferSupported) {
    throw new Error('ESTC deferred/shared ESPACK mode requires an ESPACK build/merge tool with --defer-b64 support; update ESPACK or use the normal inline mode with ESTC\'s automatic ESB64_RUNTIME_PATH override.');
  }

  // Supplying a shared codec is itself a request for deferred mode unless the
  // caller explicitly disables it (which is rejected above). This prevents a
  // subtle duplicate-runtime artifact where ESTC injects a shared ESB64 copy
  // while ESPACK simultaneously inlines its own copy.
  const wantsAutoDefer = hasSharedContract;
  const deferB64 = opts.deferB64 === true ||
    ((opts.deferB64 === 'auto' || opts.deferB64 === undefined) && wantsAutoDefer && deferSupported);

  if (deferB64 && shared.length === 0 && opts.sharedBase64 !== true) {
    throw new Error('ESTC espack.deferB64 requires espack.sharedBase64. Use true to assert the prelude provides $.global.ESB64.atob, "auto" to inject the resolved ESB64 runtime, or provide a shared codec fragment.');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'estc-espack-'));
  const out = path.join(tmp, 'loader.jsx');
  const stagedManifest = opts.manifestOut ? path.join(tmp, 'manifest.json') : null;
  try {
    const args = [];
    if (mode === 'merge') {
      args.push('--merge', ...manifests, '--out', out);
    } else {
      for (const embed of embeds) args.push('--embed', embedSpec(embed));
      args.push('--out', out);
      if (opts.dllVersion !== undefined) args.push('--dll-version', String(opts.dllVersion));
      if (opts.accel === false) args.push('--no-accel');
      else if (opts.accel) args.push('--accel', String(opts.accel));
      if (opts.accelVersion !== undefined) args.push('--accel-version', String(opts.accelVersion));
    }

    if (opts.name) args.push('--name', String(opts.name));
    if (opts.cacheDir !== undefined && opts.cacheDir !== null) args.push('--cache-dir', String(opts.cacheDir));
    if (opts.accelDir !== undefined && opts.accelDir !== null) args.push('--accel-dir', String(opts.accelDir));
    if (stagedManifest) args.push('--manifest-out', stagedManifest);
    if (deferB64) args.push('--defer-b64');
    args.push('--quiet');

    // Released ESPACK versions already support ESB64_RUNTIME_PATH. When a
    // current ESTC-validated ESB64 runtime can be resolved, use it even in
    // self-contained inline mode so ESPACK does not fall back to a stale
    // vendored runtime with persistent global polyfills.
    const env = !deferB64 && autoRuntime ? { ESB64_RUNTIME_PATH: autoRuntime } : undefined;
    const proc = runNodeTool(root, entry, args, { cwd: config.cwd, label: 'ESPACK', env });
    if (!fs.existsSync(out)) throw new Error('ESPACK completed without producing its loader: ' + out);
    const text = fs.readFileSync(out, 'utf8');
    rejectDirectives(text, out);
    const manifestText = stagedManifest && fs.existsSync(stagedManifest)
      ? fs.readFileSync(stagedManifest, 'utf8')
      : null;
    if (opts.manifestOut && manifestText === null) {
      throw new Error('ESPACK completed without producing the requested manifest sidecar.');
    }

    const pkg = toolSummary(root);
    return {
      text,
      sharedBase64: shared,
      manifest: opts.manifestOut ? {
        path: opts.manifestOut,
        text: manifestText
      } : null,
      metadata: {
        enabled: true,
        root,
        package: pkg.package,
        version: pkg.version,
        mode,
        loaderBytes: Buffer.byteLength(text),
        manifestCount: manifests.length,
        embedCount: embeds.length,
        manifestOut: opts.manifestOut || null,
        deferB64,
        deferB64Supported: deferSupported,
        base64Mode: deferB64 ? 'shared' : 'inline',
        esb64Runtime: autoRuntime,
        safeRuntimeOverride: !!(!deferB64 && autoRuntime),
        stdout: proc.stdout.trim()
      }
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
