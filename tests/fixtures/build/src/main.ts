export function floating(min: number, max: number): number {
  return min + (max - min) * Math.random();
}

export function first(values: ArrayLike<number>): number {
  if (values.length < 1) throw new RangeError('empty');
  return values[0];
}
export function makeFacade(): { float(min: number, max: number): number } {
  var api: any = {};
  api.float = floating;
  return api;
}
