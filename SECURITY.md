# Security Model

proofwars executes **untrusted Lean 4 code submitted by anonymous users**.
This document is the threat model, not boilerplate.

## Threat model

| # | Threat | Vector | Mitigation |
|---|---|---|---|
| 1 | Arbitrary code execution | `#eval`, `unsafe`, FFI, malicious `import` | Linter pass rejects `#eval`/`unsafe`/FFI before the code reaches a worker; runtime flags disable them anyway (defense in depth); imports restricted to a frozen, read-only mathlib snapshot |
| 2 | Sandbox escape | Kernel exploit from container | gVisor (runsc) user-space kernel; non-root; seccomp; all capabilities dropped |
| 3 | Resource exhaustion | Search-tactic bombs, macro expansion bombs | cgroup hard limits (1 CPU / 2GB), 10s wall-clock kill, worker recycled (not reused) after any breach |
| 4 | Data exfiltration | Network calls from proof code | Zero-egress NetworkPolicy; DNS disabled in worker pods |
| 5 | Result forgery | Client claims a proof checked | Server-authoritative only — the client renders, never verifies |
| 6 | Pool poisoning | Proof mutates shared env state | Per-match worker lease; envs mounted read-only; paranoid recycle policy |

## Enforcement in CI

`/.github/workflows/ci.yml` runs the **sandbox-escape regression suite**:
a corpus of known-hostile Lean snippets (`services/prover-pool/escape-corpus/`)
that must all fail safely on every build. A green build asserts the threat
model holds. PRs that add an escape technique to the corpus are the most
welcome PRs this repo can receive.

## Reporting

Found an escape? Email security@proofwars.dev. We'll credit you on the
site and add your technique to the corpus.
