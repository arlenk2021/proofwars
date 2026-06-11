/**
 * Proof-check latency benchmark (make bench-check-latency / make bench-report).
 *
 * Submits a stream of proof checks through the warm ProverPool and measures
 * end-to-end check latency (lease + verify + release), reporting p50/p99 and
 * GATING p50 < 500ms (ADR-0002 target). With the mock verifier the engine is
 * trivial, so this measures the *pool/lease* overhead — the part that is real.
 *
 * Modes:
 *   (default)  print a human report and exit non-zero if p50 >= 500ms.
 *   --csv      print a single CSV row (for `make bench-report >> history.csv`).
 */
import { ProverPool } from "../services/prover-pool/src/pool.js";
import {
  MockLeanVerifier,
  PUZZLES,
} from "../services/prover-pool/src/verifier.js";

const P50_GATE_MS = 500;
const N = Number(process.env.BENCH_N ?? 2000);
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 16);
const POOL_SIZE = Number(process.env.BENCH_POOL_SIZE ?? 8);

const puzzleIds = Object.keys(PUZZLES);
const proofFor = (id: string) =>
  PUZZLES[id].kind === "propositional" ? "by tauto" : "by norm_num 2 + 3";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, idx)];
}

async function run() {
  const pool = new ProverPool({
    envHash: "mathlib-frozen-2026-06",
    size: POOL_SIZE,
    makeVerifier: () => new MockLeanVerifier(),
  });

  const latencies: number[] = [];
  let next = 0;

  async function worker() {
    while (next < N) {
      const i = next++;
      const id = puzzleIds[i % puzzleIds.length];
      const t0 = performance.now();
      await pool.check({
        envHash: "mathlib-frozen-2026-06",
        puzzleId: id,
        proof: proofFor(id),
      });
      latencies.push(performance.now() - t0);
    }
  }

  const t0 = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const wall = performance.now() - t0;
  await pool.drain();

  latencies.sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p99 = percentile(latencies, 99);
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const throughput = (N / wall) * 1000;

  return { p50, p99, mean, throughput, n: N, wall };
}

const isCsv = process.argv.includes("--csv");

run()
  .then((m) => {
    if (isCsv) {
      // timestamp,n,concurrency,pool_size,p50_ms,p99_ms,mean_ms,throughput_cps,engine
      const row = [
        new Date().toISOString(),
        m.n,
        CONCURRENCY,
        POOL_SIZE,
        m.p50.toFixed(3),
        m.p99.toFixed(3),
        m.mean.toFixed(3),
        m.throughput.toFixed(1),
        "mock-lean",
      ].join(",");
      process.stdout.write(row + "\n");
      return;
    }
    const pass = m.p50 < P50_GATE_MS;
    console.log("proof-check latency benchmark");
    console.log(`  checks:      ${m.n} @ concurrency ${CONCURRENCY}, pool ${POOL_SIZE}`);
    console.log(`  wall:        ${m.wall.toFixed(0)}ms`);
    console.log(`  throughput:  ${m.throughput.toFixed(0)} checks/s`);
    console.log(`  p50:         ${m.p50.toFixed(3)}ms  (gate < ${P50_GATE_MS}ms)`);
    console.log(`  p99:         ${m.p99.toFixed(3)}ms`);
    console.log(`  mean:        ${m.mean.toFixed(3)}ms`);
    console.log(pass ? "  GATE: PASS" : "  GATE: FAIL");
    console.log(
      "\nNote: engine is the mock verifier (Lean is stubbed); this measures " +
        "real pool/lease overhead, not Lean elaboration.",
    );
    if (!pass) process.exit(1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
