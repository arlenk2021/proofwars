# Runbook: Prover pool exhaustion / traffic spike

**Symptoms:** lease wait p99 > 2s; UI showing "high traffic"; queue_depth alarm.

1. Confirm it's demand, not stuck workers: check `worker_recycles_total` rate.
   Spiking recycles = hostile/heavy proofs, not traffic → go to step 4.
2. KEDA should already be scaling. Verify HPA events; if node-bound, raise the
   node group max (spot) — cost ceiling ≈ $2/hr per 50 workers.
3. Pre-warm: new workers take ~20s (image pull + LSP boot). For a planned
   launch, set pool floor to expected-peak ÷ 0.6 one hour early.
4. If recycles are spiking: inspect the kill-timer histogram. A single theorem
   attracting search-bombs → temporarily lower the wall-clock cap for that env
   hash; capture offending scripts into the escape corpus.
5. Afterward: docs/runbooks/postmortem-template.md — and publish it.
   Incident writeups are content.
