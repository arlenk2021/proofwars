/**
 * Property-based invariants for the rating engine (fast-check).
 * These ARE the spec — the implementation answers to them.
 */
import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { update, decay, UNRATED, type Rating } from "../src/glicko2";

// P1: Symmetry — A beats B ⇒ A.r strictly increases, B.r strictly decreases.
// P2: Upset magnitude — beating a higher-rated opponent moves you more than
//     beating a lower-rated one (monotone in rating gap).
// P3: An EXPECTED result tightens RD vs. the inactivity baseline. (The naive
//     "RD never increases from play" is false in Glicko-2: a surprising upset
//     legitimately raises volatility/RD — asserted as P3b. This is the defining
//     improvement of Glicko-2 over Glicko-1.)
// P4: decay() is monotone in periodsInactive and never alters r.
// P5: Draw between equal ratings with equal RD is a fixed point of r.
// P6: New players (RD 350) move faster than veterans (RD 50) on identical
//     results — provisional ratings are honest.

// Glicko-2's RD floor under play is non-trivial; keep generators in sane,
// realistic envelopes so we test the system, not floating-point corners.
const ratingArb: fc.Arbitrary<Rating> = fc.record({
  r: fc.integer({ min: 600, max: 2800 }),
  rd: fc.integer({ min: 30, max: 350 }),
  vol: fc.double({ min: 0.02, max: 0.12, noNaN: true }),
});

// Number of property runs. Bumped high for the elo-properties gate (10k cases).
const RUNS = Number(process.env.FC_RUNS ?? 1000);

describe("glicko2 invariants", () => {
  it("P1 symmetry — winner up, loser down", () => {
    fc.assert(
      fc.property(ratingArb, ratingArb, (a, b) => {
        const aAfter = update(a, [{ opponent: b, score: 1 }]);
        const bAfter = update(b, [{ opponent: a, score: 0 }]);
        expect(aAfter.r).toBeGreaterThan(a.r);
        expect(bAfter.r).toBeLessThan(b.r);
      }),
      { numRuns: RUNS },
    );
  });

  it("P2 upset magnitude monotonicity — beating stronger moves you more", () => {
    fc.assert(
      fc.property(
        // a fixed player, two opponents where opp2 is strictly stronger.
        fc.record({
          r: fc.integer({ min: 1200, max: 1800 }),
          rd: fc.integer({ min: 40, max: 200 }),
          vol: fc.double({ min: 0.03, max: 0.08, noNaN: true }),
        }),
        fc.integer({ min: 700, max: 1400 }), // weaker opponent rating
        fc.integer({ min: 150, max: 700 }), // strictly positive gap added
        (player, weakR, gap) => {
          const rd = 50; // hold opponent RD constant to isolate the gap effect
          const vol = 0.06;
          const weak: Rating = { r: weakR, rd, vol };
          const strong: Rating = { r: weakR + gap, rd, vol };

          const vsWeak = update(player, [{ opponent: weak, score: 1 }]);
          const vsStrong = update(player, [{ opponent: strong, score: 1 }]);

          const gainWeak = vsWeak.r - player.r;
          const gainStrong = vsStrong.r - player.r;
          // Beating the stronger opponent must yield a strictly larger gain.
          expect(gainStrong).toBeGreaterThan(gainWeak);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("P3 an expected result tightens RD vs. the inactivity baseline", () => {
    // The precise, defensible reading of "RD comes down from play, not just
    // inactivity": when the game outcome MATCHES expectation, the information
    // gained tightens RD below where the same rating period with NO game would
    // land (pure inactivity inflation, phi* = sqrt(phi^2 + sigma^2)).
    //
    // NB: Glicko-2's volatility mechanism means a *surprising* result can
    // legitimately RAISE RD (the system has become less sure of you). That is
    // correct and is asserted separately in P3b below — so the naive "RD never
    // increases from play" is false in general; this is the true invariant.
    fc.assert(
      fc.property(
        // strong player vs. clearly weaker opponent, player wins (expected).
        fc.record({
          r: fc.integer({ min: 1800, max: 2600 }),
          rd: fc.integer({ min: 40, max: 350 }),
          vol: fc.double({ min: 0.02, max: 0.08, noNaN: true }),
        }),
        fc.integer({ min: 600, max: 1200 }),
        (a, weakR) => {
          const opp: Rating = { r: weakR, rd: 60, vol: 0.06 };
          const idle = update(a, []);
          const played = update(a, [{ opponent: opp, score: 1 }]); // expected win
          expect(played.rd).toBeLessThanOrEqual(idle.rd);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("P3b a surprising upset raises volatility (Glicko-2's defining behavior)", () => {
    // The flip side of P3: when a heavily-favored player LOSES, Glicko-2
    // increases volatility (and thus RD) — the model just learned it was wrong.
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2600 }),
        fc.integer({ min: 600, max: 1100 }),
        (strongR, weakR) => {
          const strong: Rating = { r: strongR, rd: 60, vol: 0.06 };
          const weak: Rating = { r: weakR, rd: 60, vol: 0.06 };
          const upset = update(strong, [{ opponent: weak, score: 0 }]); // loses
          // Volatility strictly rises after being surprised.
          expect(upset.vol).toBeGreaterThan(strong.vol);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("P4 decay is monotone in periodsInactive and rating-preserving", () => {
    fc.assert(
      fc.property(
        ratingArb,
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 1, max: 40 }),
        (a, n, extra) => {
          const dn = decay(a, n);
          const dMore = decay(a, n + extra);
          // rating never changes
          expect(dn.r).toBeCloseTo(a.r, 9);
          expect(dMore.r).toBeCloseTo(a.r, 9);
          // RD monotonically non-decreasing in inactivity
          expect(dMore.rd).toBeGreaterThanOrEqual(dn.rd - 1e-9);
          // never exceeds the ceiling
          expect(dMore.rd).toBeLessThanOrEqual(350 + 1e-9);
          // identity at 0
          if (n === 0) expect(dn.rd).toBeCloseTo(a.rd, 9);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("P5 draw between equal-rating, equal-RD players is a fixed point of r", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 600, max: 2800 }),
        fc.integer({ min: 30, max: 350 }),
        fc.double({ min: 0.02, max: 0.12, noNaN: true }),
        (r, rd, vol) => {
          const p: Rating = { r, rd, vol };
          const opp: Rating = { r, rd, vol };
          const after = update(p, [{ opponent: opp, score: 0.5 }]);
          // Identical players drawing: expected score is exactly 0.5, so the
          // rating must not move.
          expect(after.r).toBeCloseTo(r, 6);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("P6 provisional players (RD 350) move faster than veterans (RD 50)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 900, max: 2100 }),
        ratingArb,
        fc.constantFrom<0 | 0.5 | 1>(0, 1),
        (r, opponent, score) => {
          const newbie: Rating = { r, rd: 350, vol: 0.06 };
          const veteran: Rating = { r, rd: 50, vol: 0.06 };
          const newbieAfter = update(newbie, [{ opponent, score }]);
          const vetAfter = update(veteran, [{ opponent, score }]);
          // Same rating, same result: the high-RD player must move further.
          const newbieMove = Math.abs(newbieAfter.r - r);
          const vetMove = Math.abs(vetAfter.r - r);
          expect(newbieMove).toBeGreaterThan(vetMove);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe("glicko2 known vectors (Glickman 2013 worked example)", () => {
  // Glickman's paper: a player rated 1500/RD 200/vol 0.06 plays three games
  // against opponents (1400/30, 1550/100, 1700/300) with results W, L, L.
  // Expected outcome from the paper: r' ≈ 1464.06, RD' ≈ 151.52, vol' ≈ 0.05999.
  it("reproduces the canonical 3-game example", () => {
    const player: Rating = { r: 1500, rd: 200, vol: 0.06 };
    const result = update(player, [
      { opponent: { r: 1400, rd: 30, vol: 0.06 }, score: 1 },
      { opponent: { r: 1550, rd: 100, vol: 0.06 }, score: 0 },
      { opponent: { r: 1700, rd: 300, vol: 0.06 }, score: 0 },
    ]);
    expect(result.r).toBeCloseTo(1464.06, 1);
    expect(result.rd).toBeCloseTo(151.52, 1);
    expect(result.vol).toBeCloseTo(0.05999, 4);
  });

  it("an idle period inflates a default player's RD via the sqrt rule", () => {
    // UNRATED is already at the ceiling; use a tightened player.
    const p: Rating = { r: 1500, rd: 200, vol: 0.06 };
    const after = update(p, []); // no games
    // phi' = sqrt(phi^2 + sigma^2); rd' slightly above 200.
    expect(after.r).toBe(1500);
    expect(after.rd).toBeGreaterThan(200);
    expect(after.vol).toBe(0.06);
  });

  it("UNRATED is the documented default", () => {
    expect(UNRATED).toEqual({ r: 1500, rd: 350, vol: 0.06 });
  });
});
