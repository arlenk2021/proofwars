import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { GameServer } from "../src/server.js";

let server: GameServer | undefined;
afterEach(async () => {
  if (server) await server.close();
  server = undefined;
});

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function nextMessage(ws: WebSocket, predicate?: (m: any) => boolean): Promise<any> {
  return new Promise((resolve) => {
    const onMsg = (data: any) => {
      const m = JSON.parse(data.toString());
      if (!predicate || predicate(m)) {
        ws.off("message", onMsg);
        resolve(m);
      }
    };
    ws.on("message", onMsg);
  });
}

describe("GameServer — authoritative WS + spectator", () => {
  it("adjudicates a race and broadcasts the result to spectators", async () => {
    server = new GameServer({ port: 0 });
    server.createMatch({
      matchId: "race",
      puzzleId: "excluded_middle",
      players: [
        { id: "alice", kind: "human" },
        { id: "claude", kind: "llm", model: "claude-opus-4.8" },
      ],
    });

    const alice = await connect(server.url);
    const spectator = await connect(server.url);

    alice.send(JSON.stringify({ type: "join", matchId: "race", playerId: "alice" }));
    spectator.send(JSON.stringify({ type: "spectate", matchId: "race" }));
    await nextMessage(alice, (m) => m.type === "snapshot");
    await nextMessage(spectator, (m) => m.type === "snapshot");

    // Spectator must see the result broadcast even though they never verify.
    const specResult = nextMessage(spectator, (m) => m.type === "result");

    alice.send(JSON.stringify({ type: "submit", matchId: "race", playerId: "alice", tactic: "by tauto" }));

    const result = await specResult;
    expect(result.winnerId).toBe("alice");
    expect(server.match("race")!.state).toBe("won");

    alice.close();
    spectator.close();
  });

  it("an invalid submission broadcasts an event but no result", async () => {
    server = new GameServer({ port: 0 });
    server.createMatch({
      matchId: "m",
      puzzleId: "de_morgan",
      players: [
        { id: "a", kind: "human" },
        { id: "b", kind: "human" },
      ],
    });
    const a = await connect(server.url);
    a.send(JSON.stringify({ type: "join", matchId: "m", playerId: "a" }));
    await nextMessage(a, (m) => m.type === "snapshot");

    const ev = nextMessage(a, (m) => m.type === "event");
    a.send(JSON.stringify({ type: "submit", matchId: "m", playerId: "a", tactic: "intro h" }));
    const event = await ev;
    expect(event.event.outcome).toBe("invalid");
    expect(server.match("m")!.state).toBe("live");
    a.close();
  });
});
