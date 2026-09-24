export default {
  host: 'illustrator',

  // Types-for-Adobe currently provides Illustrator/2015.3 and Illustrator/2022.
  // Treat this as a compile-time API baseline, not proof of 2026 runtime behavior.
  hostTypes: 'Illustrator/2022',
  additionalTypes: [
    // './types/illustrator-2026-verified-overrides.d.ts'
  ],

  entry: 'src/jsx-entry.ts',
  outfile: 'dist/MyLibrary.jsx',
  globalName: '__MY_LIBRARY_ENTRY__',
  target: 'illustrator',

  sourceLint: true,
  typecheck: true,
  normalize: true,

  // Rewrites esbuild's ES5-only IIFE export helpers into bundle-local ES3-safe
  // helpers. This does not patch Object or Function.prototype in Illustrator.
  compatibilityTransforms: ['esbuild'],

  // Built-in global shims are disabled by policy. Use a project prelude only
  // when a deliberate project-owned polyfill is required.
  compatibilityShims: [],

  // Project-specific capabilities may be explicitly approved only when the
  // project supplies a verified implementation.
  allowedMissingBuiltins: [],

  // Persistent core/prototype mutations are forbidden unless the project is
  // intentionally a polyfill library and enumerates the exact owned surface.
  allowedGlobalPatches: [],

  // Additional raw JSX fragments can be injected before/after the bundled body.
  prelude: [],
  footer: [],

  allowJson: false,
  allowIncludes: false,

  // Optional distribution stages. When enabled, ESPACK composes before ESMIN;
  // ESTC validates both the assembled and final minified artifacts.
  //
  // espack: {
  //   mode: 'merge',
  //   manifests: ['../eson/dist/ESON.manifest.json', '../esarr/dist/ESARR.manifest.json'],
  //   manifestOut: 'dist/MyLibrary.espack.json'
  // },
  // esmin: {
  //   profile: 'conservative',
  //   keepIntermediate: true
  // },
  espack: null,
  esmin: null,

  // CI/default builds stay static. Enable only on a Windows host with Illustrator.
  live: false,
  liveLaunch: false
};
