export { composeEspack, inspectEspack } from './espack.mjs';
export { inspectEsmin, minifyWithEsmin } from './esmin.mjs';

import { inspectEspack } from './espack.mjs';
import { inspectEsmin } from './esmin.mjs';

export function inspectIntegrations(config) {
  return {
    espack: inspectEspack(config),
    esmin: inspectEsmin(config)
  };
}
