declare var FIXTURE_FACADE: any;

function floating(min: number, max: number): number {
  return min + (max - min) * Math.random();
}

function first(values: ArrayLike<number>): number {
  if (values.length < 1) throw new RangeError('empty');
  return values[0];
}

function makeFacade(): { float(min: number, max: number): number } {
  var api: any = {};
  api["float"] = floating;
  return api;
}

// Export-free side-effect entry: the public facade is attached to an undeclared
// global as a plain object literal with string keys rather than through esbuild
// entry-point exports or a globalName wrapper. This avoids emitting the esbuild
// export/CommonJS module helper topology (__defProp/__export/__toCommonJS),
// which the ESTC artifact guard rejects because descriptor/live-binding
// semantics are not portable to legacy ExtendScript engines.
FIXTURE_FACADE = {
  "floating": floating,
  "first": first,
  "makeFacade": makeFacade
};
