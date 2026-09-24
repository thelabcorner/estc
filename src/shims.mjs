/**
 * Built-in global shims are intentionally disabled.
 *
 * Illustrator ExtendScript engines are persistent. Patching Object,
 * Function.prototype, Array.prototype, or other built-ins from a reusable
 * library leaks state into unrelated scripts and can make load order observable.
 *
 * Use compatibilityTransforms for generated-code rewrites and project prelude
 * fragments only for explicit, project-owned polyfills.
 */
export function builtInShims(names) {
  const requested = (names || []).filter(Boolean);
  if (requested.length) {
    throw new Error(
      'Built-in global compatibility shims are disabled: ' + requested.join(', ') +
      '. Use compatibilityTransforms for generated helpers or an explicit project prelude for a deliberate polyfill.'
    );
  }
  return [];
}
