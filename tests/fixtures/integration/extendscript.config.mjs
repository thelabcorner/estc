export default {
  entry: "src/main.ts",
  outfile: "dist/integrated.jsx",
  globalName: "IntegrationFixture",
  target: "illustrator",
  tsconfig: "tsconfig.json",
  espack: {
    root: "../tools/espack",
    mode: "merge",
    manifests: ["manifests/a.json", "manifests/b.json"],
    name: "integration-fixture",
    manifestOut: "dist/integration.espack.json",
    deferB64: true,
    sharedBase64: { code: "var ESTC_SHARED_B64_STUB=1;" }
  },
  esmin: {
    root: "../tools/esmin",
    profile: "conservative",
    keepIntermediate: true
  }
};
