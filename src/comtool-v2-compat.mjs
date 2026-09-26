import { openIllustratorV2 } from './comtool-v2.mjs';

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
}

function allOptions(args, name) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && i + 1 < args.length) {
      out.push(args[++i]);
    }
  }
  return out;
}

function timeoutMs(args, fallback = 180000) {
  const raw = option(args, '--timeout');
  if (raw === null) return fallback;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallback;
}

function failure(error) {
  const runtimeError = error && error.envelope && error.envelope.error;
  return {
    ok: false,
    result: null,
    error: runtimeError || {
      kind: error && error.unavailable ? 'unavailable' : 'comtool_v2_error',
      message: error && error.message ? error.message : String(error)
    }
  };
}

function legacyStatus(value) {
  value = value || {};
  return {
    Name: value.name,
    Version: value.version,
    BuildNumber: value.buildNumber,
    ScriptingVersion: value.scriptingVersion,
    Locale: value.locale,
    DocumentsCount: value.documentsCount,
    ActionIsRunning: value.actionIsRunning,
    UserInteractionLevel: value.userInteractionLevel,
    CoordinateSystem: value.coordinateSystem,
    FreeMemory: value.freeMemory,
    ...value
  };
}

export function createLegacyComToolV2Runner(options = {}) {
  let session = null;
  let closed = false;

  function ensure(args) {
    if (closed) throw new Error('COM Tool V2 compatibility runner is closed.');
    if (session) return session;
    session = openIllustratorV2({
      launch: args.includes('--launch'),
      target: options.target || null,
      pipe: options.pipe || null,
      leaseWaitMs: options.leaseWaitMs,
      leaseTtlMs: options.leaseTtlMs || 600000
    });
    return session;
  }

  function run(args, runOptions = {}) {
    try {
      if (!Array.isArray(args) || args.length === 0) {
        throw new Error('Legacy COM compatibility call requires command arguments.');
      }
      const current = ensure(args);
      const command = args[0];
      if (command === 'status') {
        return { ok: true, result: legacyStatus(current.status()) };
      }
      if (command !== 'eval') {
        throw new Error(
          'Legacy COM compatibility only supports status and eval; got ' + command
        );
      }

      const file = option(args, '--file');
      const code = option(args, '--code');
      const exprs = allOptions(args, '--expr');
      const modes = (file ? 1 : 0) + (code ? 1 : 0) + (exprs.length ? 1 : 0);
      if (modes !== 1) {
        throw new Error('eval requires exactly one of --file, --code, or one/more --expr values.');
      }
      const timeout = runOptions.timeoutMs || timeoutMs(args);
      let result;
      if (file) {
        result = current.runFile(file, { timeoutMs: timeout });
      } else if (code) {
        result = current.evalCode(code, { timeoutMs: timeout });
      } else if (exprs.length === 1) {
        result = current.eval(exprs[0], { timeoutMs: timeout });
      } else {
        result = exprs.map((expr) => current.eval(expr, { timeoutMs: timeout }));
      }
      return { ok: true, result };
    } catch (error) {
      // A failed no-launch discovery is intentionally retryable by a later
      // status/eval call carrying --launch.
      if (!session) return failure(error);
      return failure(error);
    }
  }

  return {
    run,
    runText(args, runOptions = {}) {
      return JSON.stringify(run(args, runOptions));
    },
    reset() {
      if (closed) throw new Error('COM Tool V2 compatibility runner is closed.');
      if (session) {
        const current = session;
        session = null;
        current.close();
      }
    },
    close() {
      if (closed) return;
      closed = true;
      if (session) {
        const current = session;
        session = null;
        current.close();
      }
    }
  };
}
