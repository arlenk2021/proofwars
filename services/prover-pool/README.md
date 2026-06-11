# prover-pool

Manages the fleet of warm, sandboxed Lean 4 workers.

**What it does:** holds N pre-warmed Lean LSP processes per theorem
environment hash; leases them to matches; recycles on anomaly; reports
queue depth for autoscaling.

**Run locally:** `docker compose up prover-pool` (spawns 2 workers).

**Failure modes & dashboards:**
- Pool exhaustion → backpressure signal to game server → UI banner.
  Runbook: docs/runbooks/scaling-the-prover-farm.md
- Worker OOM/timeout → recycle + Prometheus counter `worker_recycles_total`
- Grafana: pool utilization, lease wait p99, check latency histogram

**The escape corpus** lives in `escape-corpus/` — hostile Lean snippets the
CI runs against every build. Adding to it is the most welcome PR this
repo accepts.

---

## ⚠️ Honest boundary: what is real vs. stubbed

Real Lean 4 + mathlib is **not** installed in this build (too heavy). The
deliverable here is the **infrastructure around** the prover, which is fully
real and tested:

| Component | Status |
|---|---|
| `Verifier` interface (`src/verifier.ts`) | **real** abstraction |
| Lean proof **engine** | **STUBBED** — `MockLeanVerifier` decides a small built-in puzzle set (propositional tautologies by truth table + simple equational goals). It is not Lean. |
| Warm pool / lease manager (`src/pool.ts`) | **real** — pre-warm N, lease, recycle-not-reuse on timeout/anomaly/quota, bounded queue + backpressure |
| Prometheus counters (`src/metrics.ts`) | **real** — `worker_recycles_total`, lease grant/reject, pool gauges |
| Docker sandbox + escape corpus | **real** — `make escape-suite` runs hostile payloads through a locked-down container (no net, dropped caps, read-only fs, mem/cpu/pids caps, timeout) and asserts containment. gVisor (ADR-0001) is the production runtime; the suite auto-uses `runsc` if present, else plain docker. |

Production swaps `MockLeanVerifier` for a gVisor-sandboxed Lean LSP behind the
same `Verifier` interface — nothing downstream changes.

### Escape suite

```bash
docker build -t prover-worker services/prover-pool
python3 services/prover-pool/escape-corpus/run-escape-suite.py
# or: make escape-suite
```

8 hostile snippets (network egress, rootfs write, secret read, env exfil, fork
bomb, mem bomb, cpu spin, capability/priv-esc probe). All must be CONTAINED.
The mem bomb is OOM-killed by the memory cgroup (exit 137); the cpu spin is
wall-clock killed; the fork bomb hits the pids cap. Removing the hardening makes
a snippet emit an `ESCAPE_*` marker and the suite fails — the gate is real.
