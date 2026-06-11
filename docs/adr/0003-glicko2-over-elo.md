# ADR-0003: Glicko-2 over vanilla ELO

**Status:** Accepted · **Date:** 2026-06

## Context
Early player base is small and sparse; many players will have <10 matches.
Vanilla ELO has no concept of rating *confidence*, so sparse histories
produce volatile, untrustworthy ladders.

## Decision
Glicko-2. Rating deviation (RD) models uncertainty explicitly, decays with
inactivity, and produces honest "provisional" badges for new players.
Separate ladders: human-vs-human, vs-LLM, and unrated daily-puzzle streaks.

## Consequences
- (+) Sparse-data honesty; provisional ratings become a UX feature.
- (−) More parameters (τ, RD floor) → all constants documented and
  property-tested in packages/elo (closed-system conservation, RD decay
  monotonicity).
