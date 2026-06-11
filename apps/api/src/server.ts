/**
 * Authoritative WebSocket game server.
 *
 * One match = one server-side state machine (Match). Clients connect, JOIN as a
 * player or SPECTATE, and SUBMIT proofs. The server verifies through the warm
 * prover pool and broadcasts goal-state transitions to all spectators. Clients
 * never verify anything (SECURITY #5) — they receive adjudicated events only.
 *
 * Protocol (JSON text frames):
 *   client → server:
 *     { type: "join",     matchId, playerId }
 *     { type: "spectate", matchId }
 *     { type: "submit",   matchId, playerId, tactic }
 *   server → client:
 *     { type: "snapshot", snapshot }          (on join/spectate)
 *     { type: "event",    matchId, event }     (every submission, to everyone)
 *     { type: "result",   matchId, winnerId }  (on win)
 *     { type: "error",    message }
 */
import { WebSocketServer, WebSocket } from "ws";
import { Match, MatchConfig } from "./match.js";
import {
  MockLeanVerifier,
  ProverPool,
  PUZZLES,
} from "@proofwars/prover-pool";

interface Room {
  match: Match;
  sockets: Set<WebSocket>;
}

export interface GameServerOptions {
  port?: number;
  poolSize?: number;
}

export class GameServer {
  private wss: WebSocketServer;
  private pool: ProverPool;
  private rooms = new Map<string, Room>();
  readonly envHash = "mathlib-frozen-2026-06";

  constructor(opts: GameServerOptions = {}) {
    this.pool = new ProverPool({
      envHash: this.envHash,
      size: opts.poolSize ?? 4,
      makeVerifier: () => new MockLeanVerifier(),
    });
    this.wss = new WebSocketServer({ port: opts.port ?? 4000 });
    this.wss.on("connection", (ws) => this.onConnection(ws));
  }

  get url(): string {
    const addr = this.wss.address();
    if (addr && typeof addr === "object") return `ws://127.0.0.1:${addr.port}`;
    return "";
  }

  /** Create a match room. Both players get the same puzzle/goal. */
  createMatch(cfg: Omit<MatchConfig, "goal" | "envHash">): Match {
    const puzzle = PUZZLES[cfg.puzzleId];
    if (!puzzle) throw new Error(`unknown puzzle ${cfg.puzzleId}`);
    const full: MatchConfig = {
      ...cfg,
      envHash: this.envHash,
      goal: puzzle.goal,
    };
    // The match verifies THROUGH the pool (lease per check) — authoritative.
    const verifier = {
      engine: "pool-mock-lean",
      verify: (req: Parameters<MockLeanVerifier["verify"]>[0]) =>
        this.pool.check(req),
    };
    const match = new Match(full, verifier);
    match.start();
    this.rooms.set(cfg.matchId, { match, sockets: new Set() });
    return match;
  }

  private send(ws: WebSocket, msg: unknown): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(room: Room, msg: unknown): void {
    for (const ws of room.sockets) this.send(ws, msg);
  }

  private onConnection(ws: WebSocket): void {
    ws.on("message", async (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return this.send(ws, { type: "error", message: "bad json" });
      }
      const room = msg.matchId ? this.rooms.get(msg.matchId) : undefined;
      if (!room) return this.send(ws, { type: "error", message: "no such match" });

      switch (msg.type) {
        case "join":
        case "spectate":
          room.sockets.add(ws);
          this.send(ws, { type: "snapshot", snapshot: room.match.snapshot() });
          break;

        case "submit": {
          // Authoritative: server verifies; client cannot self-declare a win.
          try {
            const ev = await room.match.submit(msg.playerId, String(msg.tactic ?? ""));
            this.broadcast(room, { type: "event", matchId: msg.matchId, event: ev });
            if (ev.outcome === "valid") {
              this.broadcast(room, {
                type: "result",
                matchId: msg.matchId,
                winnerId: room.match.snapshot().winnerId,
              });
            }
          } catch (e) {
            this.send(ws, {
              type: "error",
              message: e instanceof Error ? e.message : String(e),
            });
          }
          break;
        }

        default:
          this.send(ws, { type: "error", message: `unknown type ${msg.type}` });
      }
    });

    ws.on("close", () => {
      for (const room of this.rooms.values()) room.sockets.delete(ws);
    });
  }

  match(matchId: string): Match | undefined {
    return this.rooms.get(matchId)?.match;
  }

  async close(): Promise<void> {
    await this.pool.drain();
    await new Promise<void>((res) => this.wss.close(() => res()));
  }
}

// Run standalone: `tsx apps/api/src/server.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new GameServer({ port: Number(process.env.PORT ?? 4000) });
  // Seed a demo match so a client can connect immediately.
  server.createMatch({
    matchId: "demo",
    puzzleId: "excluded_middle",
    players: [
      { id: "alice", kind: "human" },
      { id: "claude", kind: "llm", model: "claude-opus-4.8" },
    ],
  });
  console.log(`proofwars game server (authoritative) on ${server.url}`);
  console.log('demo match "demo": excluded_middle — alice (human) vs claude (llm)');
}
