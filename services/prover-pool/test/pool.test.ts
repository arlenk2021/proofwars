import { describe, it, expect } from "vitest";
import {
  ProverPool,
  BackpressureError,
  TimeoutError,
} from "../src/pool.js";
import { MockLeanVerifier, Verifier, VerifyResult } from "../src/verifier.js";
import { metrics } from "../src/metrics.js";

const env = "mathlib-frozen-2026-06";

function mkPool(overrides = {}) {
  return new ProverPool({
    envHash: env,
    size: 2,
    makeVerifier: () => new MockLeanVerifier(),
    ...overrides,
  });
}

describe("ProverPool — warm pool + lease manager", () => {
  it("leases, checks, and returns a result", async () => {
    const pool = mkPool();
    const r = await pool.check({
      envHash: env,
      puzzleId: "excluded_middle",
      proof: "by tauto",
    });
    expect(r.valid).toBe(true);
    await pool.drain();
  });

  it("serializes more requests than workers via the lease queue", async () => {
    const pool = mkPool({ size: 1 });
    const reqs = Array.from({ length: 5 }, () =>
      pool.check({ envHash: env, puzzleId: "and_comm", proof: "by tauto" }),
    );
    const results = await Promise.all(reqs);
    expect(results.every((r) => r.valid)).toBe(true);
    await pool.drain();
  });

  it("applies backpressure when the queue is full", async () => {
    // size 1, maxQueue 0: the 2nd concurrent request must be rejected.
    const slow: Verifier = {
      engine: "slow",
      verify: () =>
        new Promise<VerifyResult>((res) =>
          setTimeout(() => res({ valid: true, durationMs: 50 }), 50),
        ),
    };
    const pool = new ProverPool({
      envHash: env,
      size: 1,
      maxQueue: 0,
      makeVerifier: () => slow,
    });
    const first = pool.check({ envHash: env, puzzleId: "and_comm", proof: "x" });
    await Promise.resolve(); // let first grab the only worker
    await expect(
      pool.check({ envHash: env, puzzleId: "and_comm", proof: "x" }),
    ).rejects.toBeInstanceOf(BackpressureError);
    await first;
    await pool.drain();
  });

  it("recycles (does not reuse) a worker on timeout", async () => {
    const hang: Verifier = {
      engine: "hang",
      verify: () => new Promise<VerifyResult>(() => {}), // never resolves
    };
    const before = metrics.worker_recycles_total.get();
    const pool = new ProverPool({
      envHash: env,
      size: 1,
      checkTimeoutMs: 30,
      makeVerifier: () => hang,
    });
    const gensBefore = pool.generations();
    await expect(
      pool.check({ envHash: env, puzzleId: "and_comm", proof: "x" }),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(metrics.worker_recycles_total.get()).toBe(before + 1);
    // The worker was replaced by a fresh generation (recycled, not reused).
    expect(pool.generations()[0]).toBe(gensBefore[0] + 1);
    await pool.drain();
  });

  it("recycles on hygiene quota and keeps serving", async () => {
    const pool = mkPool({ size: 1, recycleAfterChecks: 1 });
    const r1 = await pool.check({ envHash: env, puzzleId: "and_comm", proof: "by tauto" });
    const r2 = await pool.check({ envHash: env, puzzleId: "and_comm", proof: "by tauto" });
    expect(r1.valid && r2.valid).toBe(true);
    // generation advanced at least once from the quota recycle.
    expect(pool.generations()[0]).toBeGreaterThanOrEqual(1);
    await pool.drain();
  });

  it("reports utilization and queue depth", async () => {
    const pool = mkPool({ size: 2 });
    expect(pool.utilization).toBe(0);
    await pool.check({ envHash: env, puzzleId: "and_comm", proof: "by tauto" });
    expect(pool.queueDepth).toBe(0);
    await pool.drain();
  });
});
