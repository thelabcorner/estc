interface RNG { float(min: number, max: number): number; }
var api: any = {};
api.float = function (min: number, max: number) { return min + max; };
void api;
