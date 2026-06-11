# Contributing

## Local setup (<10 minutes)
```bash
docker compose up      # full stack: web, api, postgres, 2 prover workers
make test              # unit + property tests
make escape-suite      # sandbox regression corpus (must pass before any PR
                       # touching services/prover-pool)
```

## What we want most
1. **Escape-corpus additions** — hostile Lean snippets that probe the sandbox.
2. **Daily puzzle theorems** — open a `theorem-suggestion` issue with the
   Lean statement, expected difficulty, and a reference proof.
3. **Glicko-2 property tests** — packages/elo aims for exhaustive invariants.

## Ground rules
- Any PR touching the prover path requires a green escape suite + one
  maintainer review.
- New ADR for any decision that future-you would ask "why?" about.
- No client-side verification logic. Ever. (See SECURITY.md threat #5.)
