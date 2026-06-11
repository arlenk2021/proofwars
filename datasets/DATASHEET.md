# Datasheet — proofwars LLM formal-reasoning failures

Following Gebru et al., "Datasheets for Datasets" (2021).

## Motivation
- **Purpose.** Capture `(goal_state, tactic, outcome)` records from competitive
  human-vs-LLM Lean theorem-proving duels, to study where LLMs fail at formal
  reasoning (wrong tactic, partial progress, invalid closes).
- **Who built it.** The proofwars project; emitted automatically by the
  authoritative game server on every duel.

## Composition
- **Instances.** One record per *proof submission* in a match (valid or not).
- **Schema** (`llm-failures.jsonl`, one JSON object per line):

  | field | type | meaning |
  |---|---|---|
  | `match_id` | string | match identifier |
  | `env_hash` | string | frozen theorem-environment hash (≈ baked mathlib image) |
  | `puzzle_id` | string | theorem/puzzle id within the env |
  | `goal_state` | string | human-readable goal shown to players |
  | `player_kind` | `human`\|`llm` | who submitted |
  | `model` | string\|null | model name for LLM submissions |
  | `tactic` | string | the submitted proof/tactic script |
  | `outcome` | `valid`\|`invalid`\|`error` | server adjudication |
  | `error` | string\|null | verifier error message, if any |
  | `duration_ms` | number | check latency |
  | `ts` | string | ISO-8601 timestamp |

- **Labels.** `outcome` is the ground-truth label, produced by the SERVER's
  verifier — never by a client (SECURITY #5). It is therefore trustworthy.

## Collection process
- Records are derived from the append-only match event log
  (`Match.toFailureRecords`). The shipped `llm-failures.jsonl` is a **seeded
  reproducible sample** produced by `make dataset` (scripted duels), not live
  traffic. Live deployments append the identical schema.

## Honest limitations (READ THIS)
- The proof **engine is a stand-in** (`MockLeanVerifier`), not real Lean 4 —
  see `services/prover-pool/src/verifier.ts`. So `outcome` reflects the mock's
  decision procedure over a small built-in puzzle set, **not** Lean/mathlib
  elaboration. The schema, emission path, and authority model are real and
  production-shaped; the *contents* are a demonstrator until Lean is wired in.
- The seeded LLM "tactics" are illustrative of failure modes, not sampled from
  a real model's outputs.

## Uses
- Suitable now: testing the dataset pipeline, schema, and downstream tooling.
- Not yet suitable for: training/evaluating real Lean tactic models (needs the
  real Lean verifier behind the same interface first).

## Distribution & maintenance
- Ships in-repo; intended target is Hugging Face (ROADMAP M3).
- Regenerate the sample: `make dataset`.
