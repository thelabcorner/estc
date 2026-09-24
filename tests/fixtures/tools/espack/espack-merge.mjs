// fixture capability: --defer-b64
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function value(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}
const out = value('--out');
if (!out) process.exit(2);
fs.mkdirSync(path.dirname(out), { recursive: true });
const runtime = process.env.ESB64_RUNTIME_PATH && fs.existsSync(process.env.ESB64_RUNTIME_PATH)
  ? fs.readFileSync(process.env.ESB64_RUNTIME_PATH, 'utf8')
  : '';
fs.writeFileSync(out, [
  '/* ESPACK_STUB_MERGE */',
  runtime,
  'var ESPACK_STUB={float:1};',
  ''
].join('\n'), 'utf8');
const manifest = value('--manifest-out');
if (manifest) {
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(manifest, JSON.stringify({ format: 'espack-manifest', version: 1, stub: true }) + '\n');
}
