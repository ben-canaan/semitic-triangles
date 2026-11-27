// Online games: one stored record per game, shared by everyone who has the link.
//
//   POST /.netlify/functions/game                { game }                  -> create; caller takes seat 0
//   GET  /.netlify/functions/game?id=ID                                     -> current state
//   POST /.netlify/functions/game?id=ID&op=seat  { seat, name }            -> take a free seat
//   POST /.netlify/functions/game?id=ID&op=act   { token, version, action } -> place / pass / undo
//
// A seat is held by whoever has its token, which only that browser keeps.
// Every change checks the version the player last saw, so two moves can't
// land on top of each other.
import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { applyAction, PLAYER_COLORS, type Action, type Game } from "../../src/lib/triangles";

type Room = {
  game: Game;
  version: number;
  /** Seat index -> secret token. Never sent to clients. */
  tokens: Record<string, string>;
  created: string;
  updated: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const publicView = (id: string, room: Room) => ({
  id,
  game: room.game,
  version: room.version,
  seated: Object.keys(room.tokens).map(Number),
});

const randomId = (n: number) => {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => abc[b % abc.length]).join("");
};

const validGame = (g: Game) =>
  g && g.version === 1 && Array.isArray(g.players) && g.players.length >= 2 && g.players.length <= 4 &&
  Array.isArray(g.moves) && ["canaanite", "syriac", "arabic", "geez"].includes(g.alphabet);

export default async (req: Request, _context: Context) => {
  const store = getStore({ name: "games", consistency: "strong" });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const op = url.searchParams.get("op") ?? "";

  if (req.method === "POST" && !id) {
    const { game } = (await req.json().catch(() => ({}))) as { game?: Game };
    if (!game || !validGame(game)) return json({ error: "Start an online game with 2 to 4 players." }, 400);
    // Online games start fresh, with tidy names and the standard colors.
    const clean: Game = {
      ...game,
      moves: [],
      turn: 0,
      players: game.players.map((p, i) => ({ name: String(p.name || `Player ${i + 1}`).slice(0, 30), color: PLAYER_COLORS[i] })),
    };
    const newId = randomId(8);
    const token = randomId(24);
    const now = new Date().toISOString();
    const room: Room = { game: clean, version: 1, tokens: { 0: token }, created: now, updated: now };
    await store.setJSON(newId, room, { onlyIfNew: true });
    return json({ ...publicView(newId, room), seat: 0, token });
  }

  if (!/^[a-z0-9]{8}$/.test(id)) return json({ error: "No such game." }, 404);
  const found = await store.getWithMetadata(id, { type: "json" });
  if (!found) return json({ error: "No such game. It may have been mistyped." }, 404);
  const room = found.data as Room;

  if (req.method === "GET") return json(publicView(id, room));
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const save = async (next: Room) => {
    next.updated = new Date().toISOString();
    const res = await store.setJSON(id, next, { onlyIfMatch: found.etag });
    return res.modified;
  };

  if (op === "seat") {
    const seat = Number(body.seat);
    if (!Number.isInteger(seat) || seat < 0 || seat >= room.game.players.length) return json({ error: "No such seat." }, 400);
    if (room.tokens[seat]) return json({ error: "Someone already took that seat." }, 409);
    const token = randomId(24);
    const name = String(body.name ?? "").trim().slice(0, 30);
    const players = room.game.players.map((p, i) => (i === seat && name ? { ...p, name } : p));
    const next: Room = { ...room, game: { ...room.game, players }, tokens: { ...room.tokens, [seat]: token }, version: room.version + 1 };
    if (!(await save(next))) return json({ error: "Someone else just joined. Try again." }, 409);
    return json({ ...publicView(id, next), seat, token });
  }

  if (op === "act") {
    const seat = Object.entries(room.tokens).find(([, t]) => t === body.token)?.[0];
    if (seat === undefined) return json({ error: "This browser doesn't hold a seat in this game." }, 403);
    if (body.version !== room.version) return json({ error: "The board changed. Refreshing.", ...publicView(id, room) }, 409);
    const result = applyAction(room.game, Number(seat), body.action as Action);
    if (!result.game) return json({ error: result.error }, 400);
    const next: Room = { ...room, game: result.game, version: room.version + 1 };
    if (!(await save(next))) return json({ error: "The board changed. Refreshing." }, 409);
    return json(publicView(id, next));
  }

  return json({ error: "Unknown request." }, 400);
};
