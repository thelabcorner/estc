# ExtendScript Toolchain — ES* Workspace Migration Baseline

Generated from `projects/workspace-audit.json` on **2026-09-24T02:13:51.262Z**.

This ledger is migration evidence, not a claim that every flagged release artifact currently fails in Illustrator. The baseline deliberately applies the **portable conservative ESTC contract** to existing artifacts that predate it. Illustrator 30.6 is more permissive than strict ES3 in some contexts (notably reserved dot-property names), while ESTC intentionally emits/accepts the stricter portable representation.

## Baseline

- Release/runtime artifacts audited: **29**
- Portable ESTC passes: **0**
- Artifacts needing migration or an explicit contract: **29**
- Errors: **227**
- Warnings: **35**

Error/warning code counts:

| Diagnostic | Count | Meaning |
|---|---:|---|
| `ESTC_MISSING_BUILTIN` | 116 | emitted bundle still depends on an ES5-era runtime helper/capability |
| `ESTC_GLOBAL_PATCH` | 90 | artifact mutates a persistent core/prototype surface without explicit ownership |
| `ESTC_NONFINITE` | 22 | warning: NaN/Infinity token present; serialization/geometry paths require care |
| `ESTC_ES3_RESERVED_DOT_PROPERTY` | 16 | strict-ES3 portability issue; normalize to bracket access |
| `ESTC_JSON` | 8 | warning: unbound JSON global is not universally available |
| `ESTC_UNDEFINED` | 5 | warning: ES3 `undefined` is writable |
| `ESTC_STRICT` | 4 | generated `"use strict"` prologue leaked into host artifact |
| `ESTC_ES3_RESERVED_PROPERTY` | 1 | unquoted reserved object-literal key |

The dominant issue is therefore not handwritten library logic. It is the **old TypeScript/esbuild output contract**: generated helpers for `Object.defineProperty`, `Object.getOwnPropertyDescriptor`, `Object.getOwnPropertyNames`, and `Function.prototype.bind` appear repeatedly across projects.

## Per-project baseline

| Project | Artifacts | Errors | Warnings | Primary migration work |
|---|---:|---:|---:|---|
| ESON | 5 | 49 | 21 | localize esbuild helpers; remove strict prologue; rewrite strict-ES3 `.native` accesses; retain JSON2 semantics without hiding real global ownership |
| ESARR | 5 | 28 | 10 | localize generated helpers; remove strict prologue; quote reserved object key `with`; explicitly contract any intentional polyfill mutations |
| ESB64 | 5 | 39 | 0 | localize generated Object/bind helpers; remove strict prologue |
| ESCHARS | 3 | 28 | 3 | localize generated Object/bind helpers; preserve ExternalObject/native ABI behavior |
| ESHTTP | 2 | 35 | 0 | localize helpers in the composed bundle and embedded siblings; rewrite strict-ES3 `.default` accesses |
| ESRAND | 2 | 6 | 0 | replace old emitted helper dependency with ESTC bundle-local helper localization |
| ESSTR | 5 | 34 | 1 | localize generated helpers; remove strict prologue; preserve intentional String surface separately from generated helper pollution |
| ESTIMER | 2 | 8 | 0 | localize generated helpers; no source-level reserved-name blocker observed |

## Proven reference migration: ESRAND

ESRAND is the reference consumer because its source semantics are already clean enough to isolate the build-system effect.

The ESTC adapter:

`projects/esrand.config.mjs`

builds:

`evidence/esrand-estc-vendor.js`

with:

- Types-for-Adobe host checking;
- source reserved-word lint;
- bundle-local esbuild compatibility transform;
- ExtendScript-safe UglifyJS re-emission;
- live-proven switch/ASI repair;
- strict ES3/static final gate;
- compile-only live Illustrator parse.

The generated adapter passed in **Illustrator 30.6.0 / ExtendScript 4.5.6** and then passed ESRAND's live deterministic verifier at **11/11 exact groups**, including fast/bulk API parity and persistent-engine reload preservation.

That is strong evidence that ESRAND's 6 baseline errors are output-path debt, not a defect in its random-generator semantics.

## Migration rules

1. **Do not mass-allowlist generated esbuild helpers.** Move them through ESTC's bundle-local compatibility transform so they do not mutate Illustrator's persistent engine.
2. **Do not confuse intentional polyfills with accidental helper patches.** A library whose product contract deliberately installs a built-in method may enumerate the exact surface in `allowedGlobalPatches`; generated build scaffolding should not.
3. **Keep strict ES3 portability stricter than Illustrator 30.6's parser extensions.** Authoring code may keep ergonomic names such as `rng.float`; final output should use `rng["float"]`.
4. **Migrate one nested repository at a time.** For each library: current artifact audit -> ESTC side-by-side build -> static pass -> compile-only live parse -> existing project live/differential suite -> only then replace its release build path.
5. **Do not treat workspace-audit failure as runtime failure.** It is a compliance/migration gate until a project is formally migrated.
6. **Do not weaken project-specific semantics.** ESON JSON behavior, ESARR polyfill semantics, ESCHARS native boundaries, ESPACK composition, ESTIMER timing behavior, and other public contracts remain project-owned.

## Recommended migration sequence

1. **ESRAND** — reference implementation; side-by-side ESTC artifact is already static/live/behaviorally proven.
2. **ESTIMER** — small output surface and generated-helper-only blocker in the baseline.
3. **ESSTR** — close family pattern, but preserve intentional String semantics.
4. **ESB64 / ESCHARS** — generated-helper cleanup plus native/codec boundary verification.
5. **ESON** — JSON2/global semantics plus reserved `native` property normalization need extra care.
6. **ESARR** — explicitly distinguish intended polyfill ownership from build-generated global patches.
7. **ESHTTP** — migrate after its embedded sibling libraries because it composes generated ESB64/ESON payloads.

## Commands

Core toolchain gate:

```bash
cd /scripts/extendscript-toolchain
npm run verify
```

Workspace migration audit:

```bash
node bin/estc.mjs audit-workspace
```

Refresh the durable baseline:

```bash
node bin/estc.mjs audit-workspace --out evidence/workspace-audit-baseline.json
```

Optional compile-only host audit after static migrations:

```bash
node bin/estc.mjs audit-workspace --live
```

Live workspace parsing does not execute project bodies; behavioral correctness still belongs to each project's own live/differential verifier.
