# ADR-0001: Sandbox untrusted Lean execution with gVisor

**Status:** Accepted · **Date:** 2026-06

## Context
Players submit arbitrary Lean 4 tactic scripts. Lean is a full programming
language (`#eval`, FFI, metaprogramming), so "it's just math" is false —
this is arbitrary untrusted code execution as a service.

## Options considered
1. **Plain Docker containers** — shared kernel; container escapes are a known
   class; insufficient alone for anonymous-user code.
2. **Firecracker microVMs** — strongest isolation, but boot latency and memory
   overhead conflict with the warm-pool design (workers hold ~1.5GB of
   pre-loaded mathlib state).
3. **gVisor (runsc)** — user-space kernel intercepts syscalls; near-container
   density and startup; proven at scale (GKE Sandbox); modest CPU overhead
   (~10–20%) acceptable for our latency budget.
4. **WASM-compiled Lean** — elegant; toolchain not mature enough for full
   mathlib environments today. Revisit yearly.

## Decision
gVisor-sandboxed long-lived worker pods + language-level restrictions
(linter rejects `#eval`/`unsafe`/FFI) as defense in depth. Workers are
zero-egress, read-only-rootfs, non-root, resource-capped, and recycled
rather than trusted after anomalies.

## Consequences
- (+) Warm pools work: workers live for hours, leases are instant.
- (+) Two independent layers must both fail for an escape.
- (−) ~15% syscall-heavy perf tax → measured in docs/benchmarks, acceptable.
- (−) gVisor incompatibilities require pinning Lean toolchain versions and
  testing upgrades against the escape corpus before rollout.
