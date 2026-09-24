import fs from 'node:fs';
import path from 'node:path';
import { checkJsxText } from './check-jsx.mjs';
import { diagnostic } from './diagnostics.mjs';
import { runLiveParse } from './live.mjs';

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function countDiagnostics(diagnostics, severity) {
  return diagnostics.reduce((n, d) => n + (d.severity === severity ? 1 : 0), 0);
}

function diagnosticCodeCounts(diagnostics) {
  const counts = {};
  for (const d of diagnostics) {
    const key = d.code || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  );
}

export function loadWorkspaceManifest(manifestPath) {
  const file = path.resolve(manifestPath);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw || raw.version !== 1 || !Array.isArray(raw.artifacts)) {
    throw new Error('Unsupported workspace audit manifest: expected version=1 and artifacts[].');
  }
  return { file, baseDir: path.dirname(file), data: raw };
}

export function auditWorkspace(manifestPath, options = {}) {
  const loaded = loadWorkspaceManifest(manifestPath);
  const policy = loaded.data.policy || {};
  const results = [];

  for (const spec of loaded.data.artifacts) {
    if (!spec || typeof spec.path !== 'string' || !spec.path) {
      throw new Error('Every workspace artifact must define a non-empty path.');
    }

    const abs = path.resolve(loaded.baseDir, spec.path);
    const project = spec.project || path.basename(path.dirname(path.dirname(abs))) || 'unknown';
    const label = spec.label || path.basename(abs);
    const mode = spec.mode || policy.mode || 'conservative';
    const diagnostics = [];
    let checked = null;
    let live = null;

    if (!fs.existsSync(abs)) {
      diagnostics.push(diagnostic(
        'error',
        'ESTC_WORKSPACE_MISSING',
        'workspace audit artifact does not exist',
        abs,
        1,
        1,
        'Rebuild the project or update the manifest only when the release contract intentionally changed.'
      ));
    } else {
      const text = fs.readFileSync(abs, 'utf8');
      checked = checkJsxText(text, {
        file: abs,
        mode,
        target: spec.target || policy.target || 'illustrator',
        requireTarget: spec.requireTarget != null ? spec.requireTarget === true : policy.requireTarget === true,
        allowIncludes: spec.allowIncludes != null ? spec.allowIncludes === true : policy.allowIncludes === true,
        allowJson: spec.allowJson != null ? spec.allowJson === true : policy.allowJson === true,
        allowedMissingBuiltins: asArray(spec.allowedMissingBuiltins != null ? spec.allowedMissingBuiltins : policy.allowedMissingBuiltins),
        allowedGlobalPatches: asArray(spec.allowedGlobalPatches != null ? spec.allowedGlobalPatches : policy.allowedGlobalPatches)
      });
      diagnostics.push(...checked.diagnostics);

      if (options.live === true && mode === 'conservative') {
        live = runLiveParse(text, { launch: options.launch === true });
        if (!live.ok) {
          diagnostics.push(diagnostic(
            'error',
            'ESTC_WORKSPACE_LIVE_PARSE',
            live.error || live.raw || 'Illustrator live parse failed',
            abs,
            1,
            1
          ));
        }
      }
    }

    const errors = countDiagnostics(diagnostics, 'error');
    const warnings = countDiagnostics(diagnostics, 'warning');
    results.push({
      project,
      label,
      kind: spec.kind || 'release',
      path: abs,
      mode,
      exists: fs.existsSync(abs),
      ok: errors === 0,
      errors,
      warnings,
      diagnostics,
      live
    });
  }

  const projects = {};
  for (const item of results) {
    if (!projects[item.project]) {
      projects[item.project] = {
        artifacts: 0,
        passed: 0,
        failed: 0,
        errors: 0,
        warnings: 0,
        diagnosticCodes: {}
      };
    }
    const p = projects[item.project];
    p.artifacts++;
    if (item.ok) p.passed++;
    else p.failed++;
    p.errors += item.errors;
    p.warnings += item.warnings;
    for (const [code, count] of Object.entries(diagnosticCodeCounts(item.diagnostics))) {
      p.diagnosticCodes[code] = (p.diagnosticCodes[code] || 0) + count;
    }
  }

  const totals = {
    artifacts: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    errors: results.reduce((n, r) => n + r.errors, 0),
    warnings: results.reduce((n, r) => n + r.warnings, 0)
  };
  const allDiagnostics = results.flatMap((r) => r.diagnostics);

  return {
    ok: totals.failed === 0,
    manifest: loaded.file,
    generatedAt: new Date().toISOString(),
    live: options.live === true,
    totals,
    diagnosticCodes: diagnosticCodeCounts(allDiagnostics),
    projects,
    artifacts: results,
    note: 'Workspace audit is report-first. A failure does not mutate or rebuild nested projects.'
  };
}

export function summarizeWorkspaceAudit(audit) {
  return {
    ok: audit.ok,
    manifest: audit.manifest,
    live: audit.live,
    totals: audit.totals,
    diagnosticCodes: audit.diagnosticCodes,
    projects: audit.projects
  };
}
