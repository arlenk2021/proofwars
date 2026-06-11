import { describe, it, expect } from "vitest";
import { Match, MatchConfig } from "../src/match.js";
import { MockLeanVerifier, PUZZLES } from "@proofwars/prover-pool";

const verifier = new MockLeanVerifier();

function cfg(puzzleId = "excluded_middle"): MatchConfig {
  return {
    matchId: "m1",
    envHash: "env",
    puzzleId,
    goal: PUZZLES[puzzleId].goal,
    players: [
      { id: "alice", kind: "human" },
      { id: "claude", kind: "llm", model: "claude-opus-4.8" },
    ],
  };
}

describe("Match — authoritative state machine", () => {
  it("first server-verified proof wins", async () => {
    const m = new Match(cfg(), verifier);
    m.start();
    const bad = await m.submit("alice", "intro h"); // no decision tactic
    expect(bad.outcome).toBe("invalid");
    expect(m.state).toBe("live");

    const good = await m.submit("claude", "by tauto");
    expect(good.outcome).toBe("valid");
    expect(m.state).toBe("won");
    expect(m.snapshot().winnerId).toBe("claude");
  });

  it("cannot submit after the match is won (no double-win)", async () => {
    const m = new Match(cfg(), verifier);
    m.start();
    await m.submit("alice", "by tauto");
    expect(m.state).toBe("won");
    await expect(m.submit("claude", "by tauto")).rejects.toThrow(/not live/);
  });

  it("a client cannot self-declare a win — only server verification counts", async () => {
    const m = new Match(cfg(), verifier);
    m.start();
    // A bogus 'proof' that pretends to be valid is still adjudicated by the
    // verifier, which rejects it.
    const ev = await m.submit("alice", "QED trust me");
    expect(ev.outcome).toBe("invalid");
    expect(m.snapshot().winnerId).toBeNull();
  });

  it("emits (goal_state, tactic, outcome) dataset records", async () => {
    const m = new Match(cfg(), verifier);
    m.start();
    await m.submit("alice", "wrong");
    await m.submit("claude", "by tauto");
    const recs = m.toFailureRecords();
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({
      goal_state: PUZZLES["excluded_middle"].goal,
      tactic: "wrong",
      outcome: "invalid",
      player_kind: "human",
    });
    expect(recs[1]).toMatchObject({
      tactic: "by tauto",
      outcome: "valid",
      player_kind: "llm",
      model: "claude-opus-4.8",
    });
  });

  it("unknown player and not-live submissions are rejected", async () => {
    const m = new Match(cfg(), verifier);
    await expect(m.submit("alice", "by tauto")).rejects.toThrow(/not live/);
    m.start();
    await expect(m.submit("mallory", "by tauto")).rejects.toThrow(/unknown player/);
  });
});
