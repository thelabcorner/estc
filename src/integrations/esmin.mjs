import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveToolRoot, runNodeTool, toolSummary } from './tool-resolver.mjs';

function resolveRoot(config) {
  return resolveToolRoot({
    explicitRoot: config.esmin && config.esmin.root,
    envName: 'ESMIN_ROOT',
    packageName: 'es-min',
    siblingName: 'esmin',
    projectCwd: config.cwd,
    requiredFiles: ['bin/esmin.mjs', 'configs/conservative.json', 'package.json']
  });
}

function profilePath(root, opts) {
  if (opts.config) return path.resolve(opts.config);
  const profile = String(opts.profile || 'conservative');
  if (!/^[A-Za-z0-9_.-]+$/.test(profile)) {
    throw new Error('ESTC esmin.profile must be a profile name; use esmin.config for an explicit path.');
  }
  return path.join(root, 'configs', profile.endsWith('.json') ? profile : profile + '.json');
}

export function inspectEsmin(config) {
  if (!config.esmin) return {
    enabled: false,
    available: false,
    configurationValid: true,
    issues: []
  };

  const root = resolveRoot(config);
  const base = toolSummary(root);
  const issues = [];
  let configPath = null;
  if (!root) {
    issues.push('ESMIN tool could not be resolved.');
  } else {
    try {
      configPath = profilePath(root, config.esmin);
      if (!fs.existsSync(configPath)) issues.push('ESMIN config not found: ' + configPath);
    } catch (error) {
      issues.push(error.message);
    }
  }
  if (config.esmin.skipIncludes === false) {
    issues.push('ESTC-owned ESMIN execution requires skipIncludes=true.');
  }

  return {
    enabled: true,
    ...base,
    profile: config.esmin.profile || 'conservative',
    config: configPath,
    configAvailable: !!(configPath && fs.existsSync(configPath)),
    configurationValid: issues.length === 0,
    issues
  };
}

export function minifyWithEsmin(text, config) {
  const opts = config.esmin;
  if (!opts) return null;

  const root = resolveRoot(config);
  if (!root) {
    throw new Error('ESTC ESMIN integration is enabled, but ESMIN could not be resolved. Set esmin.root, ESMIN_ROOT, install es-min, or place it in a sibling esmin/ directory.');
  }
  const cfg = profilePath(root, opts);
  if (!fs.existsSync(cfg)) throw new Error('ESTC ESMIN config not found: ' + cfg);
  if (opts.skipIncludes === false) {
    throw new Error('ESTC ESMIN integration consumes a fully composed artifact and requires esmin.skipIncludes=true. Resolve includes before ESTC, or run ESMIN standalone when ESMIN itself must own include resolution.');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'estc-esmin-'));
  const input = path.join(tmp, 'input.jsx');
  const output = path.join(tmp, 'output.jsx');
  try {
    fs.writeFileSync(input, text, 'utf8');
    const args = ['--in', input, '--config', cfg, '--out', output];
    if (opts.skipIncludes !== false) args.push('--skip-includes');
    const proc = runNodeTool(root, 'bin/esmin.mjs', args, { cwd: config.cwd, label: 'ESMIN' });
    if (!fs.existsSync(output)) throw new Error('ESMIN completed without producing its output: ' + output);
    const minified = fs.readFileSync(output, 'utf8');
    const beforeBytes = Buffer.byteLength(text);
    const bytes = Buffer.byteLength(minified);
    const pkg = toolSummary(root);
    return {
      text: minified,
      metadata: {
        enabled: true,
        root,
        package: pkg.package,
        version: pkg.version,
        profile: opts.profile || null,
        config: cfg,
        beforeBytes,
        bytes,
        reductionBytes: beforeBytes - bytes,
        reductionPercent: beforeBytes ? ((beforeBytes - bytes) * 100 / beforeBytes) : 0,
        skipIncludes: opts.skipIncludes !== false,
        stdout: proc.stdout.trim()
      }
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
