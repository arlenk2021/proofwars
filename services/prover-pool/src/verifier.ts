/**
 * Verifier abstraction.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ HONEST BOUNDARY: Lean 4 is NOT wired up here.                            │
 * │ In production this interface is backed by a gVisor-sandboxed Lean LSP    │
 * │ worker (see ADR-0001). For this build the *architecture* — the pool,    │
 * │ lease manager, recycle policy, backpressure, and the docker sandbox     │
 * │ containment — is the real, tested deliverable. The proof ENGINE is a    │
 * │ stand-in: `MockLeanVerifier` decides a small built-in puzzle set        │
 * │ (propositional tautologies + simple equational goals) that it can       │
 * │ genuinely check. Everything downstream of `Verifier` is real.           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * The contract: given a theorem-environment hash and a candidate proof,
 * return {valid, error, durationMs}. Pure of game logic — no scoring here.
 */

export interface VerifyRequest {
  /** Hash identifying the frozen theorem environment (≈ baked .olean image). */
  envHash: string;
  /** The puzzle/theorem id within that environment. */
  puzzleId: string;
  /** The candidate proof text (tactic script, or our mock proof DSL). */
  proof: string;
}

export interface VerifyResult {
  valid: boolean;
  error?: string;
  durationMs: number;
}

export interface Verifier {
  readonly engine: string;
  verify(req: VerifyRequest): Promise<VerifyResult>;
}

/* ─────────────────────── Mock puzzle set ─────────────────────── */

export interface Puzzle {
  id: string;
  /** Human-readable goal state shown to players / logged to the dataset. */
  goal: string;
  kind: "propositional" | "equational";
  /** For propositional puzzles: the boolean formula over variables a,b,c,... */
  formula?: string;
  /** Variable names used by `formula`. */
  vars?: string[];
  /** For equational puzzles: a canonical accepted proof token set. */
  accepts?: (proof: string) => boolean;
}

/**
 * A genuinely decidable mini-corpus. Propositional goals are checked by
 * exhaustive truth table (the proof must assert the goal is a tautology, e.g.
 * by submitting `by tauto` / `tableau`); equational goals are checked by a
 * tiny normalizer. This is a real decision procedure for THESE goals.
 */
export const PUZZLES: Record<string, Puzzle> = {
  modus_ponens: {
    id: "modus_ponens",
    goal: "(a → (a → b)) → b   is NOT valid; (a ∧ (a → b)) → b IS",
    kind: "propositional",
    vars: ["a", "b"],
    formula: "(a && (!a || b)) ? b : true", // (a ∧ (a→b)) → b
  },
  excluded_middle: {
    id: "excluded_middle",
    goal: "a ∨ ¬a",
    kind: "propositional",
    vars: ["a"],
    formula: "a || !a",
  },
  de_morgan: {
    id: "de_morgan",
    goal: "¬(a ∧ b) ↔ (¬a ∨ ¬b)",
    kind: "propositional",
    vars: ["a", "b"],
    formula: "(!(a && b)) === (!a || !b)",
  },
  contraposition: {
    id: "contraposition",
    goal: "(a → b) → (¬b → ¬a)",
    kind: "propositional",
    vars: ["a", "b"],
    // ((a→b) → (¬b→¬a))
    formula: "(!a || b) ? ((!b) ? (!a) : true) : true",
  },
  and_comm: {
    id: "and_comm",
    goal: "(a ∧ b) ↔ (b ∧ a)",
    kind: "propositional",
    vars: ["a", "b"],
    formula: "(a && b) === (b && a)",
  },
  add_comm_2_3: {
    id: "add_comm_2_3",
    goal: "2 + 3 = 3 + 2",
    kind: "equational",
    accepts: (p) => normalizeArith(p) === "5",
  },
  mul_one: {
    id: "mul_one",
    goal: "n * 1 = n   (witnessed for n := 7)",
    kind: "equational",
    accepts: (p) => normalizeArith(p) === "7",
  },
};

/** Evaluate a propositional formula tautology by exhaustive truth table. */
function isTautology(formula: string, vars: string[]): boolean {
  const n = vars.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const scope: Record<string, boolean> = {};
    for (let i = 0; i < n; i++) scope[vars[i]] = Boolean(mask & (1 << i));
    // eslint-disable-next-line no-new-func
    const fn = new Function(...vars, `return (${formula});`);
    if (!fn(...vars.map((v) => scope[v]))) return false;
  }
  return true;
}

/** Tiny safe arithmetic normalizer for equational puzzles. */
function normalizeArith(proof: string): string | null {
  const m = proof.trim();
  // Accept only the shape `by norm_num <expr>` or a raw arithmetic expr.
  const expr = m.replace(/^by\s+(norm_num|decide|rfl)\s*/i, "").trim();
  if (!/^[\d+\-*/() ]+$/.test(expr)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const v = new Function(`return (${expr});`)();
    return Number.isFinite(v) ? String(v) : null;
  } catch {
    return null;
  }
}

/**
 * MockLeanVerifier — the stand-in proof engine. It accepts a proof when the
 * submitted tactic plausibly closes a goal the mock can actually decide:
 *   • propositional puzzle: proof contains a "decision" tactic
 *     (`tauto`, `decide`, `tableau`) AND the goal is a genuine tautology.
 *   • equational puzzle: the proof's arithmetic normalizes to the witness.
 * Anything else (including a `decide` on a non-tautology) is rejected.
 */
export class MockLeanVerifier implements Verifier {
  readonly engine = "mock-lean@0.1 (STUB — not real Lean; see verifier.ts)";

  async verify(req: VerifyRequest): Promise<VerifyResult> {
    const t0 = performance.now();
    const puzzle = PUZZLES[req.puzzleId];
    const done = (valid: boolean, error?: string): VerifyResult => ({
      valid,
      error,
      durationMs: performance.now() - t0,
    });

    if (!puzzle) return done(false, `unknown puzzle: ${req.puzzleId}`);
    const proof = req.proof.trim();
    if (proof.length === 0) return done(false, "empty proof");

    if (puzzle.kind === "propositional") {
      const usesDecision = /\b(tauto|decide|tableau)\b/i.test(proof);
      if (!usesDecision)
        return done(false, "no decision tactic (try `by tauto`)");
      const ok = isTautology(puzzle.formula!, puzzle.vars!);
      return ok
        ? done(true)
        : done(false, "goal is not a tautology — proof does not close it");
    }

    // equational
    const norm = normalizeArith(proof);
    if (norm === null) return done(false, "could not normalize proof");
    return puzzle.accepts!(proof)
      ? done(true)
      : done(false, `normalized to ${norm}, does not match goal`);
  }
}
