<div align="center">

# ESTC: TypeScript-to-ExtendScript build and compatibility tooling for Adobe ExtendScript (ES3)

## ExtendScript Toolchain = ESTC

### Host-aware typing, conservative ES3 emission, static compatibility gates, and optional live Illustrator parsing

[![Version](https://img.shields.io/badge/version-v0.1.0-blue)](https://github.com/thelabcorner/estc/releases/tag/v0.1.0)
[![Static tests](https://img.shields.io/badge/static%20tests-29%2F29-success)](#validation)
[![Workspace audit](https://img.shields.io/badge/ES*%20artifacts-29%2F29-success)](#validation)
[![Illustrator](https://img.shields.io/badge/Illustrator-30.6.0%20live--parsed-success)](#compatibility)
[![Node](https://img.shields.io/badge/Node-%3E%3D20-blue)](#compatibility)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue)](#type-environment)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

---

## Part Of The Same Toolkit

> Production-grade ExtendScript infrastructure for Illustrator-era JavaScript engines.

<table>
<tr>
<td width="50%" valign="top">

### Runtime Primitives

**[ESON](https://github.com/thelabcorner/eson)**  
Strict RFC 8259 JSON for ExtendScript.

**[ESB64](https://github.com/thelabcorner/es-b64)**  
Base64 and UTF-8 utilities.

**[ESARR](https://github.com/thelabcorner/es-arr)**  
ES5+ Array compatibility methods.

**[ESSTR](https://github.com/thelabcorner/es-str)**  
String whitespace and trim methods.

**[ESCHARS](https://github.com/thelabcorner/es-chars)**  
Native bulk byte operations.

**[ESHTTP](https://github.com/thelabcorner/es-http)**  
HTTP transport for ExtendScript automation.

**[ESTIMER](https://github.com/thelabcorner/es-timer)**  
Microsecond timing for ExtendScript automation.

**[ESRAND](https://github.com/thelabcorner/es-rand)**  
Deterministic random streams and sampling for ExtendScript.

</td>
<td width="50%" valign="top">

### Build & Integration Tools

**[ESPACK](https://github.com/thelabcorner/espack)**  
Self-extracting ExternalObject bundles.

**[ESMIN](https://github.com/thelabcorner/es-min)**  
Minification for shipped JSX bundles.

**[ESABI](https://github.com/thelabcorner/esabi)**  
Modern ExternalObject ABI declarations for native integrations.

**[VectorIPC](https://github.com/thelabcorner/vector-ipc)**  
Bounded local IPC for scripting hosts and native plug-ins.

**[ESTC](https://github.com/thelabcorner/estc)**  
TypeScript-to-ExtendScript build, compatibility, and live-parse tooling.

**ESOBF** <sub>coming soon</sub>  
Obfuscation for hardened JSX distribution.

</td>
</tr>
</table>

Also from the same team: **[ArcFit.dev](https://arcfit.dev)**, deterministic arc warp for Illustrator.

---

## Table of Contents

- [Why ESTC?](#why-estc)
- [Features](#features)
  - [Pipeline](#pipeline)
  - [Type environment](#type-environment)
- [Which artifact should I use?](#which-artifact-should-i-use)
- [Get the Release](#get-the-release)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API](#api)
  - [Configuration](#configuration)
- [Validation](#validation)
- [Performance](#performance)
- [Security Model](#security-model)
- [Compatibility](#compatibility)
- [Engine quirks that shaped the design](#engine-quirks-that-shaped-the-design)
- [Development](#development)
- [Repository layout](#repository-layout)
- [Known limitations](#known-limitations)
- [Credits](#credits)
- [License](#license)

---

## Why ESTC?

Modern TypeScript tooling and Adobe ExtendScript do not share a language boundary.

Adobe's CEP TypeScript sample describes ExtendScript as an ECMAScript 3 extension, while current TypeScript no longer provides a usable ES3 output target. TypeScript deprecated `target: ES3` in 5.0 and disabled it in 5.5, recommending ES5 plus a linter or another downleveling layer for remaining ES3 environments.

That creates several independent failure classes:

- modern TypeScript can accept source that an ES3-era parser rejects;
- an ES5 bundle can still contain future-reserved identifiers such as `float` or `int`;
- generated helper code can depend on built-ins that are not portable across ExtendScript hosts;
- Adobe host typings prove compile-time shape, not parser acceptance or runtime presence;
- E4X and ExtendScript-specific syntax cannot be treated as ordinary standards ES3;
- a static parse pass is not equivalent to Illustrator's actual parser.

ESTC makes each boundary explicit and independently testable.

---

## Features

- **Host-aware TypeScript checking** — Types-for-Adobe 7.2.6 is the default declaration environment, with narrow project-owned overlays for verified current-host corrections.
- **ES3 source linting** — catches reserved runtime bindings, unsafe unquoted object keys, and export aliases before bundling.
- **Deterministic ES5 bundling** — esbuild 0.28.2 produces one IIFE boundary before compatibility normalization.
- **Bundle-local helper localization** — recurring generated-helper hazards are rewritten locally; ESTC does not patch persistent `Object`, `Function.prototype`, or other Illustrator globals.
- **ExtendScript-safe re-emission** — UglifyJS 3.19.3 re-emits quoted keys, legacy-safe property access, ASCII-only output, explicit braces, and semicolons without compression or mangling.
- **Illustrator parser-output repair** — AST-scoped repair handles live-proven switch/ASI parser edge cases while preserving case-expression evaluation order.
- **Strict emitted-JSX gate** — Acorn in `ecmaVersion: 3` plus explicit ExtendScript hazard analysis rejects syntax/global leakage that a normal modern parser would permit.
- **Raw ExtendScript mode** — E4X and Adobe/Mozilla extensions can receive compatibility scanning without a false claim of ordinary ES3 grammar conformance.
- **Compile-only live parsing** — optional Windows/Illustrator verification sends the complete emitted body through `DoJavaScript` inside a non-invoked function expression.
- **Versioned host evidence** — reserved-word matrices, host-feature observations, and declaration-provenance evidence are stored separately from normative grammar rules.
- **Workspace audit** — report-first auditing can summarize many release/runtime artifacts without mutating the projects being inspected.

---

### Pipeline

```text
TypeScript source
    |
    | 1. Types-for-Adobe + verified project overlays
    | 2. TypeScript AST ExtendScript source lint
    v
esbuild IIFE bundle (ES5)
    |
    | 3. localize known generated helper dependencies inside the bundle
    |    (never patch persistent Illustrator built-ins)
    | 4. remove generated strict-mode prologues
    v
UglifyJS compatibility re-emission
    |
    | extendscript:true
    | ie:true
    | quote_keys:true
    | keep_quoted_props:true
    | semicolons:true
    | braces:true
    | ascii_only:true
    | compress:false
    | mangle:false
    v
Illustrator parser-output repair
    |
    | 5. repair live-proven switch/ASI edge cases without changing
    |    case-expression evaluation order
    v
Portable JSX
    |
    | 6. strict ES3 grammar + explicit reserved-property checks
    | 7. ExtendScript/Illustrator runtime hazard checks
    v
Static PASS
    |
    | 8. optional Windows/Illustrator compile-only parse
    v
Live parse PASS
    |
    | 9. project-specific runtime / differential tests
    v
Release evidence
```

The stages are deliberately separate. A type declaration is not parser evidence; parser evidence is not runtime-behavior evidence.

---

### Type environment

#### Types-for-Adobe

The default compile-time environment is pinned to:

```text
types-for-adobe 7.2.6
Illustrator/2022
```

The installed profile currently contains 412 declaration names across six source files.

Projects can layer narrow current-host corrections:

```js
export default {
  hostTypes: "Illustrator/2022",
  additionalTypes: [
    "./types/illustrator-2026-verified-overrides.d.ts"
  ]
};
```

An override should name its evidence source: current Adobe documentation, a local scripting inventory, or a live host probe. Overlays are not a mechanism for suppressing real incompatibilities.

#### Adobe CEP reference

`vendor/adobe-cep/ExtendScript.d.ts` is a pinned reference copy of Adobe-CEP/Samples `TypeScript/typings/ExtendScript.d.ts`.

Its Git-blob identity is verified as:

```text
40ee27eaa15abd98abbb126ae44f829f42f2b59a
```

`audit-types` currently reports seven declaration-name overlaps, two Adobe-only names, and 405 Types-for-Adobe-only names. This is provenance/parity evidence only; it is not an API- or runtime-equivalence claim.

Adobe's MIT license for that reference file is retained beside it.

---

## Which artifact should I use?

| | **CLI** | **JavaScript API** |
|---|---|---|
| Entry | `bin/estc.mjs` | `src/index.mjs` plus `./check` and `./build` exports |
| Interface | `estc <command>` | imported functions |
| Best for | builds, CI, release gates, evidence generation | custom tooling and programmatic integration |
| Host requirement | Node.js 20+ | Node.js 20+ |
| Illustrator required | only for `--live`, `probe-host`, and `probe-reserved` | only when invoking live verification |

**Rule of thumb:** use the CLI for project/release workflows; import the API only when ESTC is one stage inside another Node tool.

---

## Get the Release

**[ESTC v0.1.0](https://github.com/thelabcorner/estc/releases/tag/v0.1.0)** is the first public pre-release.

The release includes a deterministic source archive and checksum manifest. ESTC is not currently published to npm; source consumers should pin the Git tag rather than tracking mutable `main`.

---

## Installation

Clone the repository and install the pinned dependency graph:

```bash
git clone https://github.com/thelabcorner/estc.git
cd estc
npm ci
```

Run directly:

```bash
node bin/estc.mjs doctor
node bin/estc.mjs check path/to/script.jsx --no-target
```

Or expose the local CLI as `estc`:

```bash
npm link
estc doctor
```

---

## Quick Start

Create `extendscript.config.mjs`:

```js
export default {
  host: "illustrator",
  hostTypes: "Illustrator/2022",
  entry: "src/index.ts",
  outfile: "dist/script.jsx",
  globalName: "MyScript",
  target: "illustrator",

  sourceLint: true,
  typecheck: true,
  normalize: true,

  compatibilityTransforms: ["esbuild"],
  compatibilityShims: [],
  allowedMissingBuiltins: [],
  allowedGlobalPatches: [],

  prelude: [],
  footer: [],
  allowJson: false,
  allowIncludes: false,

  live: false,
  liveLaunch: false
};
```

Build:

```bash
node bin/estc.mjs build --config ./extendscript.config.mjs
```

Add a real Illustrator parser gate on Windows:

```bash
node bin/estc.mjs build --config ./extendscript.config.mjs --live --launch
```

Project-specific behavioral tests remain a separate release requirement. A successful ESTC parse/build does not prove application semantics.

---

## API

The CLI currently exposes:

```text
estc doctor [--config FILE] [--json]
estc check FILE [--raw] [--no-target] [--allow-json] [--allow-includes] [--live] [--launch] [--json]
estc lint-ts FILE... [--json]
estc audit-types [--config FILE] [--json]
estc audit-workspace [--manifest FILE] [--live] [--launch] [--out FILE] [--json]
estc build [--config FILE] [--live] [--launch] [--json]
estc probe-host [--launch] [--out FILE] [--json]
estc probe-reserved [--launch] [--out FILE] [--json]
```

### `doctor`

Reports the active Node/toolchain versions, host type profile, grammar baseline, compatibility policy, and resolved configuration.

### `check`

Checks an emitted JSX artifact. Conservative mode claims ES3 grammar compatibility; `--raw` intentionally does not and is intended for E4X/ExtendScript-only sources.

### `lint-ts`

Runs the TypeScript AST source-dialect checks before bundling.

### `audit-types`

Verifies the pinned Adobe CEP declaration snapshot and inventories declaration-name overlap against the selected Types-for-Adobe profile.

### `build`

Runs the complete config-driven pipeline and writes the final JSX artifact.

### `audit-workspace`

Aggregates diagnostics across a manifest of external artifacts. It is report-first and does not mutate the audited projects.

### `probe-host` / `probe-reserved`

Runs controlled live probes and writes versioned evidence for the concrete installed Illustrator/ExtendScript engine.

---

### Configuration

Key options:

| Option | Default | Meaning |
|---|---|---|
| `host` | `illustrator` | semantic host label |
| `hostTypes` | `Illustrator/2022` | Types-for-Adobe profile |
| `additionalTypes` | `[]` | verified local `.d.ts` overlays |
| `entry` | `src/index.ts` | JSX-oriented TypeScript entry |
| `outfile` | `dist/script.jsx` | final artifact |
| `globalName` | unset | esbuild IIFE namespace |
| `target` | `illustrator` | Adobe `#target` value |
| `sourceLint` | `true` | TypeScript AST compatibility lint |
| `typecheck` | `true` | host declaration type-check |
| `normalize` | `true` | compatibility re-emission |
| `compatibilityTransforms` | `["esbuild"]` | bundle-local generated-helper rewrites |
| `compatibilityShims` | `[]` | built-in global shims; disabled by policy |
| `allowedMissingBuiltins` | `[]` | explicit project capability exceptions |
| `allowedGlobalPatches` | `[]` | intentional project-owned polyfill mutations |
| `prelude` / `footer` | `[]` | raw JSX fragments/files |
| `allowJson` | `false` | suppress JSON-global warning only when supplied/verified |
| `allowIncludes` | `false` | whether unresolved `#include` is acceptable |
| `live` | `false` | compile-only Illustrator parse during build |
| `liveLaunch` | `false` | permit the live verifier to launch Illustrator |

Paths are resolved relative to the config file.

---

## Validation

| Check | Command | Result |
|---|---|---|
| Static test suite | `npm test` | 29/29 pass |
| Toolchain/environment audit | `node bin/estc.mjs doctor --json` | pass on Node v22.23.2 / Windows x64 |
| Type provenance/parity | `node bin/estc.mjs audit-types --json` | pinned Adobe blob verified; 412-name Types-for-Adobe profile inventoried |
| Full portable gate | `npm run verify` | pass |
| ES* workspace audit | `node bin/estc.mjs audit-workspace --json` | 29/29 primary release/runtime artifacts pass, 0 errors |
| Live parser fixture | config-driven build with `--live` | pass on Illustrator 30.6.0 / ExtendScript 4.5.6 |
| ESRAND behavioral reference | project release gate | 11/11 exact live groups on Illustrator 30.6.0 / ExtendScript 4.5.6 |

The 29 static tests cover reserved identifiers/keys/properties, raw-mode behavior, lexical-scope-aware global detection, missing built-ins, feature-guard scoping, explicit global-patch ownership, TypeScript source linting, compatibility re-emission, switch parser repair, generated-helper localization, Adobe type-source provenance, workspace manifest aggregation, and a complete config-driven build fixture.

The ES* workspace audit is ecosystem evidence, not a requirement for third-party ESTC users. Its manifest references sibling projects that are not part of this repository.

---

## Performance

ESTC is build-time tooling; it adds no persistent runtime service.

Measured on Windows x64 with Node v22.23.2 on 2026-09-24:

| Lane | Result |
|---|---:|
| 29-test static suite | 777 ms |
| Full config-driven build fixture within the suite | 159 ms |

These figures are development-machine measurements, not cross-platform guarantees. Project compilation time scales with TypeScript graph size, bundle size, normalization work, and optional live-host startup/COM latency.

---

## Security Model

ESTC is a local build tool with an optional Adobe host boundary.

- **Static `check`, `lint-ts`, `doctor`, and `audit-types` do not execute target JSX.**
- **`build` executes the configured local Node toolchain** and reads project-owned config/prelude/footer files; treat configuration files as trusted build code.
- **Compile-only `--live` parsing strips Adobe preprocessor directives and sends the emitted body to Illustrator inside a non-invoked function expression.** Its purpose is parser acceptance without installing or invoking the project's globals.
- **`probe-host` and `probe-reserved` intentionally execute controlled diagnostic probes** in the installed host and should be treated as active evidence-generation commands.
- **`audit-workspace` is report-first** and does not rewrite, clean, reset, or otherwise mutate audited sibling repositories.
- **Generated helper compatibility is bundle-local.** ESTC does not silently patch persistent `Object`, `Function.prototype`, or other host built-ins.
- **Compatibility exceptions are explicit.** Missing built-ins and persistent global patches require project-owned declarations in configuration instead of hidden allowlists.

Do not run untrusted ESTC config files: like other JavaScript build configurations, they are executable Node modules.

Security reports should use GitHub's private vulnerability reporting for this repository rather than a public issue when disclosure would create avoidable risk.

---

## Compatibility

| Target | Status |
|---|---|
| Node.js 20+ | supported static toolchain runtime |
| Windows x64 | supported; live Illustrator integration available |
| Linux | static toolchain supported by CI; no Illustrator live lane |
| Adobe Illustrator 30.6.0 | live parser/probe evidence recorded |
| ExtendScript 4.5.6 | live parser/probe evidence recorded |
| Illustrator type profile | Types-for-Adobe `Illustrator/2022` baseline + optional verified overlays |
| E4X / ExtendScript-only syntax | supported by `--raw` scanning; no ordinary ES3 grammar claim |
| Other Adobe hosts | static policies may be reusable, but current live evidence is Illustrator-specific |

The conservative grammar baseline is **ECMA-262 3rd Edition, December 1999, §7.5 Reserved Words**, parsed with Acorn `ecmaVersion: 3`.

---

## Engine quirks that shaped the design

### ES3 future-reserved words still matter

ECMA-262 Edition 3 reserves a Java-era future-keyword set that modern TypeScript authoring commonly treats as ordinary property names:

```text
abstract boolean byte char class const debugger double enum export extends
final float goto implements import int interface long native package private
protected public short static super synchronized throws transient volatile
```

Illustrator 30.6.0 / ExtendScript 4.5.6 rejected the complete tested reserved/future-reserved/literal set as runtime identifiers, parameters, function names, and unquoted object-literal keys.

The same parser accepted the tested tokens after dot access and bracket access. ESTC still rewrites reserved dot access to bracket access under the conservative profile rather than depending on that version-specific extension.

### The `float` failure class

An ergonomic TypeScript API can be valid:

```ts
interface RNG {
  float(min: number, max: number): number;
}

var value = rng.float(0, 1);
```

while an unsafe generated representation can fail an old parser. ESTC preserves the public API while normalizing the emitted representation:

```js
rng["float"](0, 1);
```

and quoted object keys:

```js
{ "float": implementation }
```

### Generated helpers are a portability boundary

Normal esbuild IIFE/module-export output can depend on:

- `Object.defineProperty`;
- `Object.getOwnPropertyDescriptor`;
- `Object.getOwnPropertyNames`;
- `Function.prototype.bind`.

Illustrator 30.6.0 exposes the descriptor APIs used by esbuild's live export bindings, but ESTC does not generalize that observation to all ExtendScript engines. The helper transform is localized and fail-closed on unsupported capability or generated-helper shape drift.

### Illustrator switch parsing has live-proven edge cases

Compatibility re-emission alone is insufficient for every parser shape. ESTC includes AST-scoped switch repair with tests covering nested switches, strings, regexes, comments, nested headers, terminal empty labels, and side-effectful case expressions.

### ExtendScript is not just ES3

E4X and Mozilla/Adobe extensions are part of real ExtendScript code. `--raw` exists specifically so ESTC can scan those sources for host/global hazards without pretending an ordinary ES3 parser understands their grammar.

---

## Development

Install and run the portable gate:

```bash
npm ci
npm run verify
```

Useful development commands:

```bash
npm test
npm run doctor
npm run audit:types
npm run selfcheck
```

Workspace-only ES* ecosystem audit:

```bash
npm run audit:workspace
node bin/estc.mjs audit-workspace --live --launch
```

The workspace manifest is intentionally relative and external to the core compiler contract. A standalone ESTC clone does not need sibling ES* repositories for its normal tests, doctor, type audit, checking, or builds.

Static CI runs without Adobe software. Live Illustrator checks are a separate evidence class and should run only on a Windows machine with an applicable Illustrator installation.

Never label a static pass as a live Illustrator runtime pass.

---

## Repository layout

```text
estc/
├── bin/
│   └── estc.mjs                  CLI entry
├── data/
│   └── host-profiles/            version-scoped host observations
├── evidence/                     reserved-word, host, and workspace evidence
├── examples/
│   └── extendscript.config.mjs   reference project configuration
├── projects/
│   ├── esrand.config.mjs         ecosystem integration fixture
│   └── workspace-audit.json      optional sibling-project audit manifest
├── scripts/                      evidence/probe support scripts
├── src/
│   ├── build.mjs                 config-driven compiler pipeline
│   ├── check-jsx.mjs             emitted-JSX static gate
│   └── ...                       lint, normalization, live-host, provenance modules
├── tests/
│   ├── fixtures/
│   └── static.test.mjs           29-case static/build suite
├── types/                         verified local declaration overlays
├── vendor/
│   └── adobe-cep/                pinned Adobe CEP declaration reference + license
├── package.json
└── README.md
```

---

## Known limitations

- The live parser/probe lane currently targets Windows COM + Adobe Illustrator; it is not a generic cross-host Adobe automation layer.
- The default compile-time Illustrator declarations are the Types-for-Adobe 2022 profile. Current-version differences require evidence-backed overlays.
- A compile-only live parse proves parser acceptance on that host/version; it does not prove project behavior.
- `--raw` deliberately gives up a normal ES3 grammar claim so E4X/ExtendScript-specific syntax can still be scanned.
- The bundled ES* workspace audit manifest is an ecosystem integration aid, not a portable requirement for ESTC users.
- ESTC does not attempt to polyfill arbitrary missing host APIs. Project-owned compatibility behavior must remain explicit.

---

## Credits

ESTC builds on several independently maintained projects and public references:

- **ECMA International** — ECMA-262 3rd Edition provides the conservative grammar and reserved-word baseline.
- **Adobe CEP Samples** — the pinned ExtendScript TypeScript declaration reference and its MIT license are retained in `vendor/adobe-cep/`.
- **[Types-for-Adobe](https://github.com/docsforadobe/Types-for-Adobe)** — the default broad compile-time Adobe host declaration environment.
- **[TypeScript](https://github.com/microsoft/TypeScript)** — authoring and type-checking frontend.
- **[esbuild](https://github.com/evanw/esbuild)** — deterministic ES5 IIFE bundling.
- **[Acorn](https://github.com/acornjs/acorn)** — strict ES3 grammar parsing.
- **[UglifyJS](https://github.com/mishoo/UglifyJS)** — ExtendScript-safe compatibility re-emission.
- **[docsforadobe](https://github.com/docsforadobe)** and the ExtendScript community — maintained host/runtime documentation and accumulated engine knowledge.

Source references used by the project:

- ECMA-262 Edition 3: <https://ecma-international.org/wp-content/uploads/ECMA-262_3rd_edition_december_1999.pdf>
- Adobe CEP Samples: <https://github.com/Adobe-CEP/Samples>
- Adobe CEP TypeScript sample: <https://github.com/Adobe-CEP/Samples/tree/master/TypeScript>
- Types-for-Adobe: <https://github.com/docsforadobe/Types-for-Adobe>
- TypeScript ES3 target deprecation: <https://github.com/microsoft/TypeScript/issues/51909>

---

## License

ESTC is licensed under the [MIT License](LICENSE).

The pinned Adobe CEP reference file under `vendor/adobe-cep/` remains under Adobe's MIT license, copied alongside the file as `LICENSE.adobe-cep.txt`.

<p align="center"><small>ESTC: modern authoring in, conservative ExtendScript out, with each compatibility claim independently testable.</small></p>
