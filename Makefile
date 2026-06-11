# proofwars — CI targets. See .github/workflows/ci.yml.
#
# HONEST BOUNDARY: the Lean proof engine is stubbed (MockLeanVerifier). What is
# REAL and exercised by these targets: the Glicko-2 engine + P1–P6 properties,
# the warm prover pool / lease / recycle infra, the docker-sandbox escape
# containment, the latency gate, and the authoritative match protocol + dataset.

PNPM ?= pnpm
PY   ?= python3

.PHONY: install test test-elo-properties escape-suite \
        bench-check-latency bench-report dataset server cli clean

install:
	$(PNPM) install

# Whole TS + infra unit/integration suite (elo, pool, verifier, match, server).
test:
	$(PNPM) exec vitest run

# Glicko-2 invariants P1–P6 at high case count (CI: "10k cases").
test-elo-properties:
	FC_RUNS=10000 $(PNPM) exec vitest run packages/elo/test/glicko2.properties.ts

# Sandbox-escape regression corpus: build the worker image, run every hostile
# snippet through a locked-down docker sandbox, assert containment. Red here =
# broken threat model (SECURITY.md).
escape-suite:
	docker build -t prover-worker services/prover-pool
	$(PY) services/prover-pool/escape-corpus/run-escape-suite.py

# Proof-check latency: gate p50 < 500ms (ADR-0002). Non-zero exit on regression.
bench-check-latency:
	$(PNPM) exec tsx bench/check-latency.ts

# Emit one CSV row of the current benchmark (append to history in CI).
bench-report:
	@$(PNPM) exec tsx bench/check-latency.ts --csv

# Regenerate the seeded LLM-failure sample dataset.
dataset:
	$(PNPM) exec tsx apps/api/src/seed-dataset.ts

# Run the authoritative game server (ws://127.0.0.1:4000, demo match seeded).
server:
	$(PNPM) exec tsx apps/api/src/server.ts

# Connect a CLI client: make cli ARGS="ws://127.0.0.1:4000 demo alice"
cli:
	$(PNPM) exec tsx apps/api/src/cli-client.ts $(ARGS)

clean:
	rm -rf node_modules packages/*/node_modules services/*/node_modules apps/*/node_modules
