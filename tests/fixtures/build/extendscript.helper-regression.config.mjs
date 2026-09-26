export default {
  host: 'illustrator',
  hostTypes: 'Illustrator/2022',
  entry: 'src/helper-regression.ts',
  outfile: 'dist/helper-regression.jsx',
  globalName: '__FIXTURE__',
  target: 'illustrator',
  compatibilityTransforms: ['esbuild'],
  normalize: true,
  sourceLint: true,
  typecheck: true
};
