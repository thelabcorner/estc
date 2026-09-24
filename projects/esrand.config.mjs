export default {
  host: 'illustrator',
  hostTypes: 'Illustrator/2022',
  entry: '../../esrand/src/jsx-entry.ts',
  outfile: '../evidence/esrand-estc-vendor.js',
  globalName: '__ESRAND_ENTRY__',
  target: 'illustrator',
  requireTarget: false,
  sourceLint: true,
  typecheck: true,
  normalize: true,
  compatibilityTransforms: ['esbuild'],
  compatibilityShims: [],
  footer: [{
    code: [
      '(function () {',
      '  var g = null;',
      '  try { if (typeof $ !== "undefined" && $.global) { g = $.global; } } catch (e1) {}',
      '  if (!g) { try { g = (function () { return this; })(); } catch (e2) {} }',
      '  var built = __ESRAND_ENTRY__.makeFacade();',
      '  if (!g) { __ESRAND_ENTRY__.installed = built; return; }',
      '  var keep = false;',
      '  try {',
      '    var old = g.ESRAND;',
      '    var na = built.algorithm();',
      '    var oa = old && typeof old.algorithm === "function" ? old.algorithm() : null;',
      '    keep = !!(old && typeof old.version === "function" && old.version() === built.version() &&',
      '      oa && oa.id === na.id && oa.version === na.version && oa.seedVersion === na.seedVersion);',
      '    if (keep) { built = old; }',
      '  } catch (e3) { keep = false; }',
      '  if (!keep) { g.ESRAND = built; }',
      '  __ESRAND_ENTRY__.installed = built;',
      '})();',
      'var ESRAND = __ESRAND_ENTRY__.installed;'
    ].join('\n')
  }]
};
