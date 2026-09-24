/**
 * Minimal TypeScript-only supplements for ECMAScript 3 constructs that exist in
 * ExtendScript but are absent from the current Types-for-Adobe shared declarations.
 *
 * This is deliberately NOT lib.es5.d.ts. Adding the full ES5 library would make
 * TypeScript approve runtime APIs (Array#map/forEach, Object.keys, bind, etc.) that
 * the conservative ExtendScript runtime does not provide.
 *
 * Evidence:
 * - ECMA-262 Edition 3 defines EvalError, RangeError, ReferenceError, SyntaxError,
 *   TypeError, and URIError as native error constructors.
 * - ArrayLike<T> is TypeScript structural vocabulary only; it emits no runtime code.
 */

interface ArrayLike<T> {
  readonly length: number;
  readonly [n: number]: T;
}

/** ES3 native error constructors. Types-for-Adobe already declares ErrorConstructor. */
declare const EvalError: ErrorConstructor;
declare const RangeError: ErrorConstructor;
declare const ReferenceError: ErrorConstructor;
declare const SyntaxError: ErrorConstructor;
declare const TypeError: ErrorConstructor;
declare const URIError: ErrorConstructor;
