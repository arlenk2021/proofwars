import { describe, it, expect } from "vitest";
import { MockLeanVerifier, PUZZLES } from "../src/verifier.js";

const v = new MockLeanVerifier();
const env = "mathlib-frozen-2026-06";

describe("MockLeanVerifier (honest Lean stub)", () => {
  it("accepts a correct propositional proof of a tautology", async () => {
    const r = await v.verify({
      envHash: env,
      puzzleId: "excluded_middle",
      proof: "by tauto",
    });
    expect(r.valid).toBe(true);
  });

  it("rejects a decision tactic on a non-tautology env mismatch", async () => {
    // de_morgan is a tautology; supply NO decision tactic -> reject.
    const r = await v.verify({
      envHash: env,
      puzzleId: "de_morgan",
      proof: "intro h",
    });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/decision tactic/);
  });

  it("checks every built-in propositional puzzle is genuinely a tautology", async () => {
    for (const p of Object.values(PUZZLES)) {
      if (p.kind !== "propositional") continue;
      const r = await v.verify({
        envHash: env,
        puzzleId: p.id,
        proof: "by decide",
      });
      expect(r.valid, `${p.id} should be a tautology`).toBe(true);
    }
  });

  it("accepts a correct equational proof and rejects a wrong one", async () => {
    const ok = await v.verify({
      envHash: env,
      puzzleId: "add_comm_2_3",
      proof: "by norm_num 2 + 3",
    });
    expect(ok.valid).toBe(true);

    const bad = await v.verify({
      envHash: env,
      puzzleId: "add_comm_2_3",
      proof: "by norm_num 2 + 4",
    });
    expect(bad.valid).toBe(false);
  });

  it("rejects unknown puzzle and empty proof", async () => {
    expect((await v.verify({ envHash: env, puzzleId: "nope", proof: "x" })).valid).toBe(false);
    expect((await v.verify({ envHash: env, puzzleId: "and_comm", proof: "" })).valid).toBe(false);
  });

  it("reports a non-negative duration", async () => {
    const r = await v.verify({ envHash: env, puzzleId: "and_comm", proof: "by tauto" });
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
});
