// Negative regression fixture: this source deliberately uses entry-point exports
// together with a globalName wrapper so esbuild emits the export/CommonJS module
// helper topology (__defProp/__export/__toCommonJS). The ESTC build pipeline
// must REFUSE this shape: a side-effect entry that assembles the facade with
// plain object literals is required instead. Kept under the build fixture
// directory so the same toolchain config (minus globalName) runs against it and
// the final JSX static gate fails closed.
export function floating(min: number, max: number): number {
  return min + (max - min) * Math.random();
}

export function first(values: ArrayLike<number>): number {
  if (values.length < 1) throw new RangeError('empty');
  return values[0];
}
