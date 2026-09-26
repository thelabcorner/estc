import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLCHAIN_ROOT = path.dirname(HERE);
const SCRIPTS_ROOT = path.dirname(TOOLCHAIN_ROOT);
const COMTOOL_ROOT = path.join(
  SCRIPTS_ROOT,
  'agent-skills',
  'illustrator-com-automation-skill',
  'comtool-v2'
);

let requestCounter = 0;

function sleepSync(ms) {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function installedLayout() {
  if (!process.env.LOCALAPPDATA) return null;
  const root = path.join(process.env.LOCALAPPDATA, 'Programs', 'ComToolV2', 'current');
  return {
    kind: 'installed',
    cli: path.join(root, 'ComTool.Cli.exe'),
    runtime: path.join(root, 'ComTool.RuntimeHost.exe'),
    worker: path.join(root, 'ComTool.Worker.exe')
  };
}

function workspaceLayout() {
  return {
    kind: 'workspace',
    cli: path.join(
      COMTOOL_ROOT,
      'src',
      'ComTool.Cli',
      'bin',
      'Release',
      'net10.0-windows',
      'ComTool.Cli.exe'
    ),
    runtime: path.join(
      COMTOOL_ROOT,
      'src',
      'ComTool.RuntimeHost',
      'bin',
      'Release',
      'net10.0-windows',
      'ComTool.RuntimeHost.exe'
    ),
    worker: path.join(
      COMTOOL_ROOT,
      'src',
      'ComTool.Worker',
      'bin',
      'Release',
      'net10.0-windows',
      'ComTool.Worker.exe'
    )
  };
}

function completeLayout(layout) {
  return !!layout &&
    fs.existsSync(layout.cli) &&
    fs.existsSync(layout.runtime) &&
    fs.existsSync(layout.worker);
}

export function resolveComToolV2() {
  const explicitCli = process.env.COMTOOL_V2_CLI;
  const explicitRuntime = process.env.COMTOOL_V2_RUNTIME_HOST;
  const explicitWorker = process.env.COMTOOL_V2_WORKER;
  if (explicitCli || explicitRuntime || explicitWorker) {
    if (!(explicitCli && explicitRuntime && explicitWorker)) {
      throw new Error(
        'COMTOOL_V2_CLI, COMTOOL_V2_RUNTIME_HOST, and COMTOOL_V2_WORKER ' +
        'must be supplied together so ESTC cannot mix binary versions.'
      );
    }
    const explicit = {
      kind: 'explicit',
      cli: path.resolve(explicitCli),
      runtime: path.resolve(explicitRuntime),
      worker: path.resolve(explicitWorker)
    };
    if (!completeLayout(explicit)) {
      throw new Error(
        'Explicit COM Tool V2 layout is incomplete: ' +
        JSON.stringify(explicit)
      );
    }
    return explicit;
  }

  const installed = installedLayout();
  if (completeLayout(installed)) return installed;
  const workspace = workspaceLayout();
  if (completeLayout(workspace)) return workspace;

  throw new Error(
    'COM Tool V2 is unavailable. Install it under ' +
    '%LOCALAPPDATA%\\Programs\\ComToolV2\\current or build the workspace ' +
    'Release CLI/RuntimeHost/Worker.'
  );
}

function parseEnvelope(stdout, label) {
  const raw = String(stdout || '').trim();
  if (!raw) throw new Error(label + ' returned no JSON envelope.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(label + ' returned non-JSON output: ' + raw.slice(0, 1200));
  }
}

export function invokeComToolV2(cli, args, options = {}) {
  const proc = spawnSync(cli, args, {
    cwd: options.cwd || path.dirname(cli),
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeoutMs || 300000,
    maxBuffer: options.maxBuffer || (16 * 1024 * 1024)
  });
  if (proc.error) throw proc.error;

  let envelope = null;
  try {
    envelope = parseEnvelope(proc.stdout, 'COM Tool V2 ' + args[0]);
  } catch (error) {
    if (proc.status === 0) throw error;
  }

  if (proc.status !== 0 || !envelope || envelope.ok !== true) {
    const runtimeError = envelope && envelope.error ? envelope.error : null;
    const detail = runtimeError
      ? ((runtimeError.kind || 'error') + ': ' + (runtimeError.message || 'unknown error'))
      : String(proc.stderr || 'exit ' + proc.status).trim();
    const error = new Error('COM Tool V2 ' + args[0] + ' failed: ' + detail);
    error.envelope = envelope;
    error.exitCode = proc.status;
    throw error;
  }
  return envelope;
}

export function invokeComToolV2Async(cli, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, {
      cwd: options.cwd || path.dirname(cli),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error('COM Tool V2 ' + args[0] + ' timed out.'));
    }, options.timeoutMs || 300000);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let envelope = null;
      try {
        envelope = parseEnvelope(stdout, 'COM Tool V2 ' + args[0]);
      } catch (error) {
        if (status === 0) {
          reject(error);
          return;
        }
      }
      if (status !== 0 || !envelope || envelope.ok !== true) {
        const runtimeError = envelope && envelope.error ? envelope.error : null;
        const detail = runtimeError
          ? ((runtimeError.kind || 'error') + ': ' + (runtimeError.message || 'unknown error'))
          : String(stderr || 'exit ' + status).trim();
        const error = new Error('COM Tool V2 ' + args[0] + ' failed: ' + detail);
        error.envelope = envelope;
        error.exitCode = status;
        reject(error);
        return;
      }
      resolve(envelope);
    });
  });
}

function tryInvoke(cli, args, options = {}) {
  try {
    return { ok: true, envelope: invokeComToolV2(cli, args, options) };
  } catch (error) {
    return { ok: false, error };
  }
}

function resultValue(envelope) {
  return envelope && envelope.result ? envelope.result.value : undefined;
}

function runtimeHealth(layout, pipe) {
  return tryInvoke(layout.cli, ['health', '--runtime', '--pipe', pipe], {
    timeoutMs: 5000
  });
}

function makeRuntimeIdentity() {
  const suffix = process.pid + '-' + Date.now();
  return {
    pipe: 'estc-v2-' + suffix,
    stateDir: path.join(os.tmpdir(), 'estc-comtool-v2-' + suffix)
  };
}

function startOwnedRuntime(layout, pipe, stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  const child = spawn(layout.runtime, [
    '--worker', layout.worker,
    '--pipe', pipe,
    '--state-dir', stateDir,
    '--host', 'illustrator'
  ], {
    cwd: path.dirname(layout.runtime),
    windowsHide: true,
    stdio: 'ignore'
  });
  // The RuntimeHost lifetime is owned by the session, not by Node's event
  // loop. Keep the ChildProcess handle so close() can terminate it, but do not
  // let a healthy isolated runtime prevent a verifier from naturally exiting.
  child.unref();

  const deadline = Date.now() + 15000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        'COM Tool V2 RuntimeHost exited during startup with code ' +
        child.exitCode + '.'
      );
    }
    const health = runtimeHealth(layout, pipe);
    if (health.ok) return child;
    lastError = health.error;
    sleepSync(100);
  }
  try { child.kill(); } catch {}
  throw new Error(
    'Timed out starting COM Tool V2 RuntimeHost on pipe ' + pipe +
    (lastError ? ': ' + lastError.message : '')
  );
}

function launchIllustrator() {
  if (process.platform !== 'win32') {
    throw new Error('Illustrator launch is supported only on Windows.');
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    "$app=New-Object -ComObject Illustrator.Application",
    "[void]$app.Version"
  ].join('; ');
  let last = null;
  for (const exe of ['powershell.exe', 'pwsh.exe']) {
    const proc = spawnSync(exe, [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command', script
    ], {
      encoding: 'utf8',
      windowsHide: true,
      // COM activation can outlive the launcher process after a forced Adobe
      // host teardown. Do not block the caller for the entire host startup;
      // discoverTarget() below is the authority on whether launch succeeded.
      timeout: 30000
    });
    last = proc;
    if (!proc.error || proc.error.code !== 'ENOENT') {
      if (proc.error && proc.error.code === 'ETIMEDOUT') {
        // Indeterminate, not failure: Illustrator may already be starting (or
        // fully running) even though PowerShell remained blocked on COM
        // activation. The caller polls COM Tool V2 target discovery for up to
        // 90 seconds and will fail there if no target actually materializes.
        return;
      }
      if (proc.status !== 0) {
        throw new Error(
          'Could not launch Illustrator through its registered COM class: ' +
          String(proc.stderr || proc.error || 'PowerShell failed').trim()
        );
      }
      return;
    }
  }
  throw new Error(
    'PowerShell is unavailable for explicit Illustrator launch: ' +
    String(last && last.error ? last.error : 'unknown error')
  );
}

function listTargets(layout, pipe) {
  const envelope = invokeComToolV2(layout.cli, [
    'targets', '--runtime', '--pipe', pipe
  ], { timeoutMs: 30000 });
  const targets = resultValue(envelope);
  if (!Array.isArray(targets)) {
    throw new Error('COM Tool V2 targets result is not an array.');
  }
  return targets;
}

function isHostUnavailableDiscoveryFailure(error) {
  const runtimeError = error && error.envelope && error.envelope.error;
  const message = runtimeError && runtimeError.message
    ? String(runtimeError.message)
    : String(error && error.message ? error.message : '');
  return message.indexOf('MK_E_UNAVAILABLE') >= 0 ||
    message.indexOf('0x800401E3') >= 0 ||
    message.indexOf('Operation unavailable') >= 0;
}

function hasCapability(entry, name) {
  return Array.isArray(entry && entry.capabilities) &&
    entry.capabilities.some((cap) =>
      cap && cap.name === name && cap.supported === true);
}

function discoverTarget(layout, pipe, options) {
  const requestedTarget = options.target || process.env.COMTOOL_V2_TARGET || null;
  const select = () => {
    let entries;
    try {
      entries = listTargets(layout, pipe);
    } catch (error) {
      // V2 currently surfaces ROT "no active Illustrator moniker" as
      // MK_E_UNAVAILABLE instead of an empty discovery result. Treat only
      // that precise host-absent condition as zero candidates so an explicit
      // --launch request can proceed. Any other discovery failure stays fatal.
      if (isHostUnavailableDiscoveryFailure(error)) return [];
      throw error;
    }
    return entries.filter((entry) =>
      entry &&
      entry.running === true &&
      entry.target &&
      entry.target.host === 'illustrator' &&
      (!requestedTarget || entry.target.id === requestedTarget) &&
      hasCapability(entry, 'script.eval'));
  };

  let candidates = select();
  if (candidates.length === 0 && options.launch === true) {
    launchIllustrator();
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      sleepSync(250);
      candidates = select();
      if (candidates.length > 0) break;
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      requestedTarget
        ? 'Requested Illustrator target is not available through COM Tool V2: ' + requestedTarget
        : 'No running Illustrator target advertises COM Tool V2 script.eval' +
          (options.launch === true ? ' after explicit launch.' : '. Re-run with --launch only when launch is intentional.')
    );
  }
  if (!requestedTarget && candidates.length > 1) {
    throw new Error(
      'Multiple Illustrator targets are visible; set COMTOOL_V2_TARGET to one ' +
      'strong target id instead of selecting ambiguously: ' +
      candidates.map((entry) => entry.target.id).join(', ')
    );
  }
  return candidates[0];
}

function acquireLease(layout, pipe, targetId, options) {
  const waitMs = Number.isFinite(options.leaseWaitMs)
    ? options.leaseWaitMs
    : Number(process.env.COMTOOL_V2_LEASE_WAIT_MS || 60000);
  const deadline = Date.now() + Math.max(0, waitMs);
  while (true) {
    try {
      const envelope = invokeComToolV2(layout.cli, [
        'lease-acquire', '--runtime',
        '--pipe', pipe,
        '--target', targetId,
        '--ttl-ms', String(options.leaseTtlMs || 180000)
      ], { timeoutMs: 30000 });
      const value = resultValue(envelope);
      if (!value || !value.leaseId) {
        throw new Error('COM Tool V2 lease response omitted leaseId.');
      }
      return value.leaseId;
    } catch (error) {
      const runtimeError = error && error.envelope && error.envelope.error;
      if (!runtimeError ||
          runtimeError.kind !== 'target_leased_external' ||
          runtimeError.retryable !== true ||
          Date.now() >= deadline) {
        throw error;
      }
      sleepSync(Math.min(500, Math.max(1, deadline - Date.now())));
    }
  }
}

function releaseLease(layout, pipe, targetId, leaseId) {
  if (!leaseId) return;
  invokeComToolV2(layout.cli, [
    'lease-release', '--runtime',
    '--pipe', pipe,
    '--target', targetId,
    '--lease', leaseId
  ], { timeoutMs: 30000 });
}

function isRetryableWorkerHandshakeFailure(error) {
  const runtimeError = error && error.envelope && error.envelope.error;
  const message = runtimeError && runtimeError.message
    ? String(runtimeError.message)
    : String(error && error.message ? error.message : '');
  // These failures occur while the RuntimeHost is spawning/discovering its
  // read-only worker, before the requested operation can be dispatched. They
  // are therefore safe to retry in this preflight only.
  return message.indexOf('worker_start_failed') >= 0 ||
    (message.indexOf('Expected target') >= 0 &&
      message.indexOf('was not discovered') >= 0) ||
    message.indexOf('Could not establish Illustrator process identity') >= 0 ||
    message.toLowerCase().indexOf('operation was canceled') >= 0;
}

function stabilizeTargetWorker(layout, pipe, targetId, leaseId, options = {}) {
  const waitMs = Number.isFinite(options.workerStabilizeMs)
    ? options.workerStabilizeMs
    : Number(process.env.COMTOOL_V2_WORKER_STABILIZE_MS || 10000);
  const deadline = Date.now() + Math.max(0, waitMs);
  while (true) {
    try {
      invokeComToolV2(layout.cli, [
        'status', '--runtime',
        '--pipe', pipe,
        '--target', targetId,
        '--lease', leaseId
      ], { timeoutMs: 30000 });
      return;
    } catch (error) {
      if (!isRetryableWorkerHandshakeFailure(error) || Date.now() >= deadline) {
        throw error;
      }
      sleepSync(Math.min(250, Math.max(1, deadline - Date.now())));
    }
  }
}

function nextRequestId(prefix) {
  requestCounter++;
  return 'estc-' + prefix + '-' + process.pid + '-' + requestCounter;
}

function runFileCliArgs(pipe, leaseId, targetId, file, runOptions = {}) {
  const absolute = path.resolve(file);
  const args = [
    'run-file', '--runtime',
    '--pipe', pipe,
    '--lease', leaseId,
    '--request-id', runOptions.requestId || nextRequestId('file'),
    '--path', absolute,
    '--sha256', runOptions.sha256 || sha256File(absolute)
  ];
  if (runOptions.args !== undefined) {
    args.push('--args-json', JSON.stringify(runOptions.args));
  }
  args.push(
    '--timeout-ms', String(runOptions.timeoutMs || 180000),
    '--target', targetId
  );
  return args;
}

export function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function openIllustratorV2(options = {}) {
  if (process.platform !== 'win32') {
    const error = new Error(
      'Live Illustrator verification through COM Tool V2 is Windows-only.'
    );
    error.unavailable = true;
    throw error;
  }

  const layout = resolveComToolV2();
  const configuredPipe = options.pipe || process.env.COMTOOL_V2_PIPE || null;
  let pipe = configuredPipe;
  let child = null;
  let stateDir = null;
  let ownedRuntime = false;
  let targetId = null;
  let leaseId = null;
  let closed = false;

  try {
    if (!pipe) {
      const identity = makeRuntimeIdentity();
      pipe = identity.pipe;
      stateDir = identity.stateDir;
      child = startOwnedRuntime(layout, pipe, stateDir);
      ownedRuntime = true;
    } else {
      const health = runtimeHealth(layout, pipe);
      if (!health.ok) {
        const identity = makeRuntimeIdentity();
        stateDir = identity.stateDir;
        child = startOwnedRuntime(layout, pipe, stateDir);
        ownedRuntime = true;
      }
    }

    const target = discoverTarget(layout, pipe, options);
    targetId = target.target.id;
    leaseId = acquireLease(layout, pipe, targetId, options);
    // Target enumeration can briefly lead the worker's own COM discovery
    // immediately after host/runtime startup. Stabilize with a read-only
    // operation before exposing the session. Never retry caller script
    // execution: only this specific pre-execution handshake race is retried.
    stabilizeTargetWorker(layout, pipe, targetId, leaseId, options);

    const session = {
      layout,
      pipe,
      target,
      targetId,
      leaseId,
      eval(source, evalOptions = {}) {
        const envelope = invokeComToolV2(layout.cli, [
          'eval', '--runtime',
          '--pipe', pipe,
          '--lease', leaseId,
          '--request-id', evalOptions.requestId || nextRequestId('eval'),
          '--expr', source,
          '--timeout-ms', String(evalOptions.timeoutMs || 180000),
          '--target', targetId
        ], { timeoutMs: (evalOptions.timeoutMs || 180000) + 15000 });
        return resultValue(envelope);
      },
      evalCode(source, evalOptions = {}) {
        const envelope = invokeComToolV2(layout.cli, [
          'eval', '--runtime',
          '--pipe', pipe,
          '--lease', leaseId,
          '--request-id', evalOptions.requestId || nextRequestId('code'),
          '--code', source,
          '--timeout-ms', String(evalOptions.timeoutMs || 180000),
          '--target', targetId
        ], { timeoutMs: (evalOptions.timeoutMs || 180000) + 15000 });
        return resultValue(envelope);
      },
      runFile(file, runOptions = {}) {
        const envelope = invokeComToolV2(
          layout.cli,
          runFileCliArgs(pipe, leaseId, targetId, file, runOptions),
          { timeoutMs: (runOptions.timeoutMs || 180000) + 15000 }
        );
        return resultValue(envelope);
      },
      runFileEnvelope(file, runOptions = {}) {
        return invokeComToolV2(
          layout.cli,
          runFileCliArgs(pipe, leaseId, targetId, file, runOptions),
          { timeoutMs: (runOptions.timeoutMs || 180000) + 15000 }
        );
      },
      async runFileAsync(file, runOptions = {}) {
        const optionsWithRequest = {
          ...runOptions,
          requestId: runOptions.requestId || nextRequestId('file-async')
        };
        const envelope = await invokeComToolV2Async(
          layout.cli,
          runFileCliArgs(pipe, leaseId, targetId, file, optionsWithRequest),
          { timeoutMs: (runOptions.timeoutMs || 180000) + 15000 }
        );
        return resultValue(envelope);
      },
      renewLease(ttlMs = 300000) {
        const envelope = invokeComToolV2(layout.cli, [
          'lease-renew', '--runtime',
          '--pipe', pipe,
          '--target', targetId,
          '--lease', leaseId,
          '--ttl-ms', String(ttlMs)
        ], { timeoutMs: 30000 });
        const value = resultValue(envelope);
        if (!value || !value.leaseId) {
          throw new Error('COM Tool V2 lease renewal omitted leaseId.');
        }
        leaseId = value.leaseId;
        session.leaseId = leaseId;
        return leaseId;
      },
      status(statusOptions = {}) {
        const envelope = invokeComToolV2(layout.cli, [
          'status', '--runtime',
          '--pipe', pipe,
          '--target', targetId,
          '--lease', leaseId
        ], { timeoutMs: statusOptions.timeoutMs || 30000 });
        return resultValue(envelope);
      },
      close() {
        if (closed) return;
        closed = true;
        let closeError = null;
        if (leaseId && targetId) {
          try {
            releaseLease(layout, pipe, targetId, leaseId);
          } catch (error) {
            closeError = error;
          }
          leaseId = null;
        }
        if (ownedRuntime && child) {
          try { child.kill(); } catch {}
          child = null;
        }
        if (ownedRuntime && stateDir) {
          try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch {}
          stateDir = null;
        }
        if (closeError) throw closeError;
      }
    };
    return session;
  } catch (error) {
    if (leaseId && targetId) {
      try { releaseLease(layout, pipe, targetId, leaseId); } catch {}
    }
    if (ownedRuntime && child) {
      try { child.kill(); } catch {}
    }
    if (ownedRuntime && stateDir) {
      try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch {}
    }
    throw error;
  }
}

export function withIllustratorV2(options, callback) {
  const session = openIllustratorV2(options);
  let primaryError = null;
  try {
    return callback(session);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      session.close();
    } catch (closeError) {
      if (!primaryError) throw closeError;
    }
  }
}
