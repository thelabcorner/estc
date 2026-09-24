export default {
  host: 'illustrator',
  hostTypes: 'Illustrator/2022',
  entry: 'src/main.ts',
  outfile: 'dist/fixture.jsx',
  globalName: '__FIXTURE__',
  target: 'illustrator',
  compatibilityTransforms: ['esbuild'],
  normalize: true,
  sourceLint: true,
  typecheck: true
};
