# Benchmarks

## Proof-check latency (`make bench-check-latency`)

Submits N proof checks through the warm `ProverPool` at fixed concurrency and
measures end-to-end check latency (lease → verify → release). Reports p50/p99
and **gates p50 < 500ms** (ADR-0002 target).

```bash
make bench-check-latency      # human report, non-zero exit if p50 >= 500ms
make bench-report             # one CSV row → append to latency-history.csv
```

Tunables (env): `BENCH_N`, `BENCH_CONCURRENCY`, `BENCH_POOL_SIZE`.

### Honest note
The proof engine here is the **mock verifier** (Lean is stubbed — see
`services/prover-pool/src/verifier.ts`). So these numbers measure the **real
pool/lease/recycle overhead**, which is the actual deliverable, *not* Lean
elaboration time. In production the same harness would front a gVisor-sandboxed
Lean LSP; the p50<500ms budget (ADR-0002) is then dominated by elaboration, and
this harness is what would catch a regression in it.

## History
`latency-history.csv` — appended one row per `make bench-report` run.
Columns: `timestamp,n,concurrency,pool_size,p50_ms,p99_ms,mean_ms,throughput_cps,engine`.
