# Contributing to ESTC

ESTC treats compatibility claims as evidence, not folklore. Contributions are welcome when they preserve that standard.

## Development gate

```bash
npm ci
npm run verify
```

A change that affects emitted JSX should include a regression fixture in `tests/`. A change based on observed Adobe behavior should state the exact host and ExtendScript version and, when practical, add versioned evidence under `evidence/` or `data/host-profiles/`.

## Compatibility rules

- Do not weaken the conservative ES3 gate to make a project pass.
- Do not add persistent host-global patches to solve generated-code problems.
- Keep project-owned polyfills explicit through configuration.
- Preserve the distinction between standards rules, declaration evidence, static parser evidence, live parser evidence, and runtime behavior.
- Raw E4X/ExtendScript sources must not be described as ordinary ES3-compatible merely because `--raw` accepts them.
- Live Illustrator evidence must name the concrete application and engine versions.

## Pull requests

Please include:

1. the failure or capability being addressed;
2. the smallest fixture that demonstrates it;
3. the expected compatibility rule;
4. the verification commands run;
5. live-host evidence when the change depends on Adobe parser/runtime behavior.

Static CI does not require Adobe software. Live Illustrator checks are maintainer evidence and may be reproduced separately on a suitable Windows host.
