import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function value(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}
const input = value('--in');
const output = value('--out');
if (!input || !output) process.exit(2);
const source = fs.readFileSync(input, 'utf8');
const config = value('--config');
fs.mkdirSync(path.dirname(output), { recursive: true });
if (config && /invalid-output\.json$/i.test(config)) {
  fs.writeFileSync(output, '#target illustrator\nvar class=1;\n', 'utf8');
} else {
  fs.writeFileSync(output, source.replace(/\s+$/g, '') + '\nvar ESMIN_STUB=1;\n', 'utf8');
}
console.log('esmin-stub: transformed');
