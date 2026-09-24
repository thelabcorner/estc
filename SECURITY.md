# Security Policy

## Reporting a vulnerability

Use GitHub private vulnerability reporting for security-sensitive findings. Please avoid publishing exploit details in a normal issue before a fix can be prepared.

For non-sensitive compatibility defects, parser regressions, false positives, and documentation problems, use the public issue tracker.

## Trust boundary

ESTC is local build tooling. Static checking does not execute target JSX, but ESTC configuration is executable Node.js and must be treated as trusted build code.

The optional Illustrator live-parse path submits emitted code through a non-invoked function expression to test parser acceptance without invoking the project body. Diagnostic probe commands intentionally execute controlled probe code in the installed Adobe host.

Do not run ESTC configurations or probe inputs from untrusted sources.
