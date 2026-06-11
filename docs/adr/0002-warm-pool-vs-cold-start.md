# ADR-0002: Warm prover pools instead of per-request compilation

**Status:** Accepted · **Date:** 2026-06

## Context
Cold-importing mathlib takes minutes. A race needs sub-second feedback on
every proof attempt. This tension defines the architecture.

## Options considered
1. **Compile per request** — minutes of latency; dead on arrival.
2. **One giant shared Lean server** — fast, but a single state-pollution or
   crash takes down every live match; no isolation between users.
3. **Warm pool of leased workers** — pre-import a frozen mathlib snapshot
   into N long-lived Lean LSP processes per environment hash; matches lease
   a worker for their duration; checks send only the tactic-script delta.

## Decision
Option 3. Pool manager targets 60% utilization, KEDA autoscales on queue
depth, floor of 8 warm workers per active environment. Workers boot warm
in ~20s from images with pre-baked .olean caches (no compilation at boot).

## Consequences
- (+) p50 check latency is elaboration-only: target <500ms.
- (+) Capacity math is legible: 50 checks/s × 380ms ≈ 19 busy workers;
  pool of ~40 ≈ 40 cores ≈ ~$1.6/hr spot during a spike.
- (−) Every supported theorem environment needs a baked image → puzzle
  curation is coupled to image publishing (runbook: scaling-the-prover-farm).
- (−) Lease starvation under spikes → explicit backpressure to the UI
  ("high traffic") rather than silent queuing.
