import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const reservedData = JSON.parse(
  fs.readFileSync(path.join(HERE, '..', 'data', 'es3-reserved.json'), 'utf8')
);

export const ES3_RESERVED = new Set([
  ...reservedData.keywords,
  ...reservedData.futureReserved,
  ...reservedData.literals
]);

export function isEs3Reserved(name) {
  return ES3_RESERVED.has(String(name));
}
