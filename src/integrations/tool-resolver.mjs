import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ESTC_ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(import.meta.url);

function packageRootFromResolve(packageName, searchPaths) {
  try {
    const pkg = require.resolve(packageName + '/package.json', { paths: searchPaths });
    return path.dirname(pkg);
  } catch {
    return null;
  }
}

export function readToolPackage(root) {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function resolveToolRoot({
  explicitRoot,
  envName,
  packageName,
  siblingName,
  projectCwd,
  requiredFiles = []
}) {
  const candidates = [];
  if (explicitRoot) candidates.push(path.resolve(explicitRoot));
  if (envName && process.env[envName]) candidates.push(path.resolve(process.env[envName]));

  const searchPaths = [projectCwd, ESTC_ROOT].filter(Boolean);
  const packageRoot = packageRootFromResolve(packageName, searchPaths);
  if (packageRoot) candidates.push(packageRoot);

  if (projectCwd && siblingName) candidates.push(path.resolve(projectCwd, '..', siblingName));
  if (siblingName) candidates.push(path.resolve(ESTC_ROOT, '..', siblingName));

  const seen = new Set();
  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (seen.has(root)) continue;
    seen.add(root);
    if (!fs.existsSync(root)) continue;
    if (!requiredFiles.every((file) => fs.existsSync(path.join(root, file)))) continue;
    return root;
  }

  return null;
}

export function runNodeTool(root, relativeEntry, args, options = {}) {
  const entry = path.join(root, relativeEntry);
  if (!fs.existsSync(entry)) throw new Error('Tool entry not found: ' + entry);
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    maxBuffer: options.maxBuffer || (16 * 1024 * 1024)
  });
  if (result.error) {
    throw new Error(options.label + ' failed to launch: ' + result.error.message);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(options.label + ' failed with exit code ' + result.status +
      (detail ? ':\n' + detail : ''));
  }
  return {
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '')
  };
}

export function toolSummary(root) {
  if (!root) return { available: false, root: null, package: null, version: null };
  const pkg = readToolPackage(root);
  return {
    available: true,
    root,
    package: pkg && pkg.name ? pkg.name : null,
    version: pkg && pkg.version ? pkg.version : null
  };
}
