/**
 * Generate a small, seeded sample of the LLM formal-reasoning failure dataset.
 *
 * Plays a handful of scripted human-vs-LLM duels through the authoritative
 * Match machine and writes the resulting (goal_state, tactic, outcome) records
 * to datasets/llm-failures.jsonl. This is the REAL emission path the live
 * server uses (Match.toFailureRecords) — just driven by a seeded script so the
 * repo ships a reproducible sample alongside the datasheet.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Match, MatchConfig, FailureRecord } from "./match.js";
import { MockLeanVerifier, PUZZLES } from "@proofwars/prover-pool";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../../../datasets/llm-failures.jsonl");
const verifier = new MockLeanVerifier();

// Seeded duels: an LLM proposing tactics (some wrong, mirroring real failure
// modes) racing a human. Deterministic so the sample is reproducible.
const duels: Array<{
  matchId: string;
  puzzleId: keyof typeof PUZZLES;
  llmModel: string;
  // ordered (player, tactic) submissions
  script: Array<["human" | "llm", string]>;
}> = [
  {
    matchId: "seed-1",
    puzzleId: "excluded_middle",
    llmModel: "gpt-5",
    script: [
      ["llm", "by exact em a"], // no decision tactic recognized → invalid
      ["llm", "by cases a"], // still no decision tactic → invalid
      ["human", "by tauto"], // human closes it
    ],
  },
  {
    matchId: "seed-2",
    puzzleId: "de_morgan",
    llmModel: "claude-opus-4.8",
    script: [
      ["llm", "by push_neg"], // invalid in mock
      ["llm", "by tauto"], // valid → llm wins
    ],
  },
  {
    matchId: "seed-3",
    puzzleId: "add_comm_2_3",
    llmModel: "gemini-2.5",
    script: [
      ["llm", "by norm_num 2 + 4"], // wrong arithmetic → invalid
      ["human", "by norm_num 2 + 3"], // human correct
    ],
  },
  {
    matchId: "seed-4",
    puzzleId: "contraposition",
    llmModel: "gpt-5",
    script: [
      ["llm", "intro h; intro hb"], // partial, no decision → invalid
      ["llm", "by decide"], // valid → llm wins
    ],
  },
];

async function main() {
  const all: FailureRecord[] = [];
  for (const duel of duels) {
    const cfg: MatchConfig = {
      matchId: duel.matchId,
      envHash: "mathlib-frozen-2026-06",
      puzzleId: duel.puzzleId,
      goal: PUZZLES[duel.puzzleId].goal,
      players: [
        { id: "human-1", kind: "human" },
        { id: "llm-1", kind: "llm", model: duel.llmModel },
      ],
    };
    const m = new Match(cfg, verifier);
    m.start();
    for (const [who, tactic] of duel.script) {
      if (m.state !== "live") break;
      await m.submit(who === "human" ? "human-1" : "llm-1", tactic);
    }
    all.push(...m.toFailureRecords());
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, all.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const llmFails = all.filter((r) => r.player_kind === "llm" && r.outcome !== "valid").length;
  console.log(`wrote ${all.length} records → ${OUT}`);
  console.log(`  llm submissions: ${all.filter((r) => r.player_kind === "llm").length}`);
  console.log(`  llm failures:    ${llmFails}`);
}

main();
