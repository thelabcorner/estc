export default {
  entry: "src/main.ts",
  outfile: "dist/auto.jsx",
  globalName: "IntegrationAutoFixture",
  target: "illustrator",
  tsconfig: "tsconfig.json",
  espack: {
    root: "../tools/espack",
    esb64Root: "../tools/esb64",
    mode: "merge",
    manifests: ["manifests/a.json", "manifests/b.json"],
    deferB64: "auto",
    sharedBase64: "auto"
  }
};
