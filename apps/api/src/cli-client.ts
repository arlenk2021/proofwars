/**
 * Minimal CLI client to play / spectate a match against the authoritative
 * server. The client renders only — it submits tactics and shows adjudicated
 * events; it never decides validity (SECURITY #5).
 *
 * Usage:
 *   tsx apps/api/src/cli-client.ts <ws-url> <matchId> <playerId> [--spectate]
 * Then type a tactic per line (e.g. `by tauto`) and press enter.
 */
import { WebSocket } from "ws";
import { createInterface } from "node:readline";

const [, , url = "ws://127.0.0.1:4000", matchId = "demo", playerId = "alice"] =
  process.argv;
const spectate = process.argv.includes("--spectate");

const ws = new WebSocket(url);

ws.on("open", () => {
  ws.send(
    JSON.stringify(
      spectate
        ? { type: "spectate", matchId }
        : { type: "join", matchId, playerId },
    ),
  );
  if (!spectate) {
    console.log(`joined ${matchId} as ${playerId}. Type a tactic + enter:`);
    const rl = createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      const tactic = line.trim();
      if (tactic) ws.send(JSON.stringify({ type: "submit", matchId, playerId, tactic }));
    });
  } else {
    console.log(`spectating ${matchId}…`);
  }
});

ws.on("message", (data) => {
  const m = JSON.parse(data.toString());
  switch (m.type) {
    case "snapshot":
      console.log(`GOAL: ${m.snapshot.goal}  [${m.snapshot.status}]`);
      break;
    case "event":
      console.log(
        `  ${m.event.playerId} (${m.event.playerKind}) → "${m.event.tactic}" : ${m.event.outcome}` +
          (m.event.error ? ` (${m.event.error})` : ""),
      );
      break;
    case "result":
      console.log(`*** ${m.winnerId} WINS ***`);
      break;
    case "error":
      console.error(`error: ${m.message}`);
      break;
  }
});

ws.on("close", () => process.exit(0));
