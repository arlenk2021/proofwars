/**
 * Authoritative match state machine.
 *
 * SECURITY #5: the client renders, never verifies. Validity is decided ONLY by
 * the server calling the Verifier (through the prover pool). A client cannot
 * claim a win — it can only SUBMIT a proof, and the server adjudicates. This
 * file is pure (no I/O, no WS) so the authority is unit-testable.
 *
 * Two players get the SAME theorem. First server-verified proof wins. Every
 * submission (valid or not) is recorded as a (goal_state, tactic, outcome)
 * event — the spectator stream and the LLM-failure dataset both derive from
 * this append-only log.
 */
import type { Verifier, VerifyResult } from "@proofwars/prover-pool";

export type PlayerKind = "human" | "llm";

export interface MatchPlayer {
  id: string;
  kind: PlayerKind;
  /** Model name for llm players, used in the dataset. */
  model?: string;
}

export interface MatchConfig {
  matchId: string;
  envHash: string;
  puzzleId: string;
  goal: string; // human-readable goal state, broadcast to spectators
  players: [MatchPlayer, MatchPlayer];
}

export type MatchStatus = "pending" | "live" | "won" | "aborted";

export interface SubmissionEvent {
  seq: number;
  ts: number;
  playerId: string;
  playerKind: PlayerKind;
  model?: string;
  tactic: string; // the submitted proof/tactic
  outcome: "valid" | "invalid" | "error";
  error?: string;
  durationMs: number;
}

export interface MatchSnapshot {
  matchId: string;
  status: MatchStatus;
  goal: string;
  winnerId: string | null;
  events: SubmissionEvent[];
}

/** A dataset record per the README/datasheet schema. */
export interface FailureRecord {
  match_id: string;
  env_hash: string;
  puzzle_id: string;
  goal_state: string;
  player_kind: PlayerKind;
  model: string | null;
  tactic: string;
  outcome: "valid" | "invalid" | "error";
  error: string | null;
  duration_ms: number;
  ts: string; // ISO
}

export class Match {
  readonly config: MatchConfig;
  private status: MatchStatus = "pending";
  private winnerId: string | null = null;
  private events: SubmissionEvent[] = [];
  private seq = 0;
  private readonly verify: (proof: string) => Promise<VerifyResult>;

  constructor(
    config: MatchConfig,
    verifier: Verifier,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.config = config;
    this.verify = (proof) =>
      verifier.verify({
        envHash: config.envHash,
        puzzleId: config.puzzleId,
        proof,
      });
  }

  start(): void {
    if (this.status !== "pending") throw new Error("already started");
    this.status = "live";
  }

  get state(): MatchStatus {
    return this.status;
  }

  snapshot(): MatchSnapshot {
    return {
      matchId: this.config.matchId,
      status: this.status,
      goal: this.config.goal,
      winnerId: this.winnerId,
      events: [...this.events],
    };
  }

  private playerById(id: string): MatchPlayer | undefined {
    return this.config.players.find((p) => p.id === id);
  }

  /**
   * Server-authoritative submission. Returns the recorded event. The ONLY way
   * to win is for the server's own verification to come back valid.
   */
  async submit(playerId: string, tactic: string): Promise<SubmissionEvent> {
    if (this.status !== "live") throw new Error(`match not live (${this.status})`);
    const player = this.playerById(playerId);
    if (!player) throw new Error(`unknown player ${playerId}`);

    let outcome: SubmissionEvent["outcome"];
    let error: string | undefined;
    let durationMs = 0;
    try {
      const res = await this.verify(tactic);
      durationMs = res.durationMs;
      outcome = res.valid ? "valid" : "invalid";
      error = res.error;
    } catch (e) {
      outcome = "error";
      error = e instanceof Error ? e.message : String(e);
    }

    const ev: SubmissionEvent = {
      seq: this.seq++,
      ts: this.now(),
      playerId,
      playerKind: player.kind,
      model: player.model,
      tactic,
      outcome,
      error,
      durationMs,
    };
    this.events.push(ev);

    // First VALID proof wins — adjudicated here, not by any client.
    if (outcome === "valid" && this.status === "live") {
      this.status = "won";
      this.winnerId = playerId;
    }
    return ev;
  }

  abort(): void {
    if (this.status === "live" || this.status === "pending") {
      this.status = "aborted";
    }
  }

  /** Derive dataset records (every submission, with goal state + outcome). */
  toFailureRecords(): FailureRecord[] {
    return this.events.map((e) => ({
      match_id: this.config.matchId,
      env_hash: this.config.envHash,
      puzzle_id: this.config.puzzleId,
      goal_state: this.config.goal,
      player_kind: e.playerKind,
      model: e.model ?? null,
      tactic: e.tactic,
      outcome: e.outcome,
      error: e.error ?? null,
      duration_ms: e.durationMs,
      ts: new Date(e.ts).toISOString(),
    }));
  }
}
