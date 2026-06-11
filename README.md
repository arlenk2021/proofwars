# ⚔️ proofwars

**Competitive theorem proving. Race a human — or an LLM — to close the goal.**

[Live site](#) · [Play today's Proofle](#) · [LLM failure dataset](#) · [Architecture](ARCHITECTURE.md)

<!-- demo.gif: 8-second split-screen proof race -->

## What is this?

Two players get the same Lean 4 theorem. First valid proof wins.
ELO ratings. Daily puzzle. Spectator mode. Human-vs-LLM duels.

## The interesting engineering

- **Untrusted Lean code execution at scale** — gVisor-sandboxed prover pool with
  warm mathlib instances. p50 proof-check latency target: <500ms.
  See [SECURITY.md](SECURITY.md) for the threat model and
  [ADR-0001](docs/adr/0001-lean-sandbox-via-gvisor.md) for why gVisor.
- **Real-time multiplayer** over authoritative server state — the client never
  verifies anything, so cheating-by-client is structurally impossible.
- **A growing public dataset of LLM formal-reasoning failures** — every
  human-vs-LLM duel emits structured `(goal_state, tactic, outcome)` records.

## Quickstart

```bash
git clone https://github.com/arlenkumar/proofwars && cd proofwars
docker compose up        # web :3000, api :4000, 2 warm prover workers
```

## Repo map

| Path | What |
|---|---|
| `apps/web` | Next.js game UI + spectator mode |
| `apps/api` | Phoenix game server (1 match = 1 BEAM process) |
| `services/prover-pool` | Warm Lean worker lease manager |
| `packages/elo` | Glicko-2 rating engine — pure, property-tested |
| `docs/adr` | Why we built it this way |
| `datasets/` | LLM proof-failure dataset + datasheet |

## Build status — what is real vs. stubbed (read this)

This repo is a working build of the **infrastructure**, with the Lean engine
honestly stubbed (real Lean + mathlib is too heavy to ship here). The boundary:

| Capability | Status |
|---|---|
| **Glicko-2 rating engine** (`packages/elo`) | **REAL** — full Glickman (2013) `update`/`decay`, Illinois volatility solver, property-tested P1–P6 at 10k cases + the paper's worked-example vector |
| **Warm prover pool / lease manager** (`services/prover-pool`) | **REAL** — pre-warm, lease, recycle-not-reuse, backpressure, Prometheus counters |
| **Docker sandbox + escape corpus** | **REAL** — `make escape-suite` runs hostile payloads through a locked-down container and asserts containment (gVisor = production runtime, ADR-0001) |
| **Authoritative match server** (`apps/api`) | **REAL** — match state machine + WebSocket server, spectator broadcast, server-only adjudication (SECURITY #5) |
| **LLM-failure dataset** (`datasets/`) | **REAL** emission path + schema + datasheet (seeded sample) |
| **Lean 4 proof engine** | **STUBBED** — `MockLeanVerifier` decides a small built-in puzzle set behind the real `Verifier` interface; swap for a sandboxed Lean LSP, nothing downstream changes |

### Run it

```bash
make install
make test                  # whole TS suite (elo, pool, verifier, match, server)
make test-elo-properties   # Glicko-2 P1–P6, 10k cases
make escape-suite          # build worker image + run sandbox-escape corpus
make bench-check-latency   # proof-check latency, p50 < 500ms gate
make server                # authoritative ws server :4000 (seeds a demo match)
make cli ARGS="ws://127.0.0.1:4000 demo alice"   # play; type `by tauto`
make dataset               # regenerate seeded LLM-failure sample
```

🚧 Pre-launch. See [ROADMAP.md](ROADMAP.md).
