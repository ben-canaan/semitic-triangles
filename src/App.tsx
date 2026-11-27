import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BookOpen, Crosshair, ExternalLink, Globe, Lightbulb, Link2, Minus, Plus, RotateCw, SkipForward, Star as StarIcon, Undo2, X,
} from "lucide-react";
import {
  ALPHABETS, AlphabetId, Action, Game, H, LANGUAGES, Lexicon, RootIndex, RootSense, STAR_BONUS, WordList, applyAction, buildRootIndex,
  hintsFor, lookupRoot, scoreboard, starsOf, textDir, wordsFor, LATIN_HINT, SCRIPT_FONT, SCRIPT_LABEL, ScriptId, Tri,
  arrangements, boardOf, canPlayAt, checkRoot, decodeGame, encodeGame, fixedCorners, glyph,
  letterFromKey, newGame, parseStoredGame, parseTri, tKey, translit, triAt, triCentroid,
  triVerts, vPos,
} from "@/lib/triangles";

const STORAGE_KEY = "semitic-triangles:game";
const SEAT_KEY = (id: string) => `semitic-triangles:seat:${id}`;
const API = "/.netlify/functions/game";

/** An online game this browser is looking at; seat and token only if it holds a seat. */
type Online = { id: string; version: number; seated: number[]; seat: number | null; token: string | null };
type ServerView = { id: string; game: Game; version: number; seated: number[]; seat?: number; token?: string; error?: string };

const api = async (query: string, body?: unknown): Promise<{ ok: boolean; status: number; data: ServerView }> => {
  const res = await fetch(`${API}${query}`, body === undefined
    ? { cache: "no-store" }
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: "The game server didn't answer." }));
  return { ok: res.ok, status: res.status, data };
};

const readSeat = (id: string): { seat: number; token: string } | null => {
  try { return JSON.parse(localStorage.getItem(SEAT_KEY(id)) ?? "null"); } catch { return null; }
};
const writeSeat = (id: string, seat: number, token: string) => {
  try { localStorage.setItem(SEAT_KEY(id), JSON.stringify({ seat, token })); } catch { /* storage blocked */ }
};
const ESSAY_URL = "https://whitmanic.substack.com/p/semitic-triangles-the-most-obscure";

type Camera = { x: number; y: number; z: number };
const MIN_Z = 18;
const MAX_Z = 240;
const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

const defaultGame = () => newGame("canaanite", ["Player 1", "Player 2"]);

// Centre of the played area, so a loaded game opens where the action is.
const centreOf = (game: Game): [number, number] => {
  if (game.moves.length === 0) return [0.5, H / 3];
  let x = 0, y = 0;
  for (const m of game.moves) {
    const [cx, cy] = triCentroid(parseTri(m.tri));
    x += cx; y += cy;
  }
  return [x / game.moves.length, y / game.moves.length];
};

const rootText = (root: string[], game: Game) => root.map((l) => glyph(l, game.script)).join(" ");
const rootTranslit = (root: string[], game: Game) => root.map((l) => translit(l, game.alphabet)).join("-");

// ===================================================================== page

const App = () => {
  const [game, setGame] = useState<Game>(defaultGame);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [root, setRoot] = useState<string[]>([]);
  const [arrIdx, setArrIdx] = useState(0);
  const [gloss, setGloss] = useState("");
  // Kept between moves: players tend to stay in one language for a while.
  const [lang, setLang] = useState("");
  const [inspected, setInspected] = useState<number | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  // A script from the other alphabet, waiting for the player to agree to a fresh board.
  const [pendingScript, setPendingScript] = useState<ScriptId | null>(null);
  const [lex, setLex] = useState<Lexicon | null>(null);
  const [words, setWords] = useState<{ he: WordList | null; ar: WordList | null } | null>(null);
  const [online, setOnline] = useState<Online | null>(null);
  const [onlineSetup, setOnlineSetup] = useState(false);
  const onlineRef = useRef<Online | null>(null);
  onlineRef.current = online;
  const gameRef = useRef(game);
  gameRef.current = game;
  const [cam, setCam] = useState<Camera>({ x: 0.5, y: H / 3, z: 130 });

  const board = useMemo(() => boardOf(game), [game]);
  const rootIndex = useMemo(() => (lex ? buildRootIndex(lex, game.alphabet) : null), [lex, game.alphabet]);
  const rootInfo = rootIndex && root.length === 3 ? lookupRoot(rootIndex, root) : null;
  const selTri = selected ? parseTri(selected) : null;
  const fixed = selTri ? fixedCorners(board, selTri) : null;
  const arrs = fixed && root.length === 3 ? arrangements(fixed, root) : [];
  const verdict = selTri ? checkRoot(game, board, selTri, root) : null;
  const preview = arrs.length ? arrs[arrIdx % arrs.length] : null;
  const current = game.players[game.turn % game.players.length];
  const myTurn = !online || online.seat === game.turn % game.players.length;
  const used = useMemo(() => new Set(game.moves.map((m) => m.root.join(""))), [game.moves]);
  const stars = useMemo(() => starsOf(game), [game]);

  // The root dictionary loads separately so the board appears at once.
  useEffect(() => {
    import("@/data/roots.json").then((m) => setLex(m.default as unknown as Lexicon)).catch(() => {});
  }, []);

  // Words for the root explorer: loaded the first time someone opens it.
  const loadWords = useCallback(() => {
    if (words) return;
    setWords({ he: null, ar: null });
    Promise.all([import("@/data/words-he.json"), import("@/data/words-ar.json")])
      .then(([h, a]) => setWords({ he: h.default as unknown as WordList, ar: a.default as unknown as WordList }))
      .catch(() => {});
  }, [words]);

  // ------------------------------------------------------------- online play
  /** Take the server's version of an online game, keeping this viewer's choice of script. */
  const adopt = useCallback((v: ServerView, seat?: { seat: number; token: string } | null) => {
    const prev = gameRef.current;
    const g = { ...v.game, script: prev.alphabet === v.game.alphabet ? prev.script : v.game.script };
    const was = onlineRef.current;
    // Tell this player what the others just did.
    if (was && was.id === v.id && v.version > was.version && g.moves.length > prev.moves.length) {
      const m = g.moves[g.moves.length - 1];
      if (m.player !== was.seat)
        toast(`${g.players[m.player]?.name} played ${rootTranslit(m.root, g)}${m.gloss ? ` (${m.gloss})` : ""}.`);
    }
    setGame(g);
    setOnline({
      id: v.id, version: v.version, seated: v.seated,
      seat: seat ? seat.seat : was?.id === v.id ? was.seat : null,
      token: seat ? seat.token : was?.id === v.id ? was.token : null,
    });
  }, []);

  const joinRoom = useCallback(async (id: string) => {
    const { ok, data } = await api(`?id=${id}`);
    if (!ok) { toast.error(data.error ?? "That online game couldn't be opened."); return false; }
    adopt(data, readSeat(id));
    const [x, y] = centreOf(data.game);
    setCam((c) => ({ ...c, x, y }));
    return true;
  }, [adopt]);

  // Keep the board current: a quick check every couple of seconds, slower in the background.
  useEffect(() => {
    if (!online) return;
    let stop = false;
    let timer: number;
    const tick = async () => {
      const o = onlineRef.current;
      if (stop || !o) return;
      try {
        const { ok, data } = await api(`?id=${o.id}`);
        if (ok && data.version > (onlineRef.current?.version ?? 0)) adopt(data);
      } catch { /* offline for a moment */ }
      timer = window.setTimeout(tick, document.hidden ? 15000 : 2000);
    };
    timer = window.setTimeout(tick, 2000);
    const wake = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", wake);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", wake); };
  }, [online?.id, adopt]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Send a move to the server, or apply it here when playing on this device. */
  const act = useCallback(async (action: Action): Promise<boolean> => {
    const o = onlineRef.current;
    if (!o) {
      const g = gameRef.current;
      const player = action.type === "undo" ? g.moves[g.moves.length - 1]?.player ?? 0 : g.turn % g.players.length;
      const res = applyAction(g, player, action);
      if (!res.game) { toast(res.error); return false; }
      setGame(res.game);
      return true;
    }
    if (o.seat === null || !o.token) { toast("Take a seat to play. You're watching this game."); return false; }
    let version = o.version;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { ok, status, data } = await api(`?id=${o.id}&op=act`, { token: o.token, version, action });
      if (ok) { adopt(data); return true; }
      if (status === 409 && data.game) {
        adopt(data);
        // Someone joined or the version moved on without touching the board: try once more.
        const sameBoard = data.game.moves.length === gameRef.current.moves.length && data.game.turn === gameRef.current.turn;
        if (attempt === 0 && sameBoard && applyAction(data.game, o.seat, action).game) { version = data.version; continue; }
        if (!sameBoard) { toast("The board changed before your move landed. Have another look."); return false; }
      }
      toast(data.error ?? "That move didn't go through.");
      return false;
    }
    return false;
  }, [adopt]);

  const startOnline = async (names: string[]) => {
    const g = { ...newGame(game.alphabet, names), script: game.script };
    const { ok, data } = await api("", { game: g });
    if (!ok || data.seat === undefined || !data.token) { toast.error(data.error ?? "Couldn't start an online game."); return; }
    writeSeat(data.id, data.seat, data.token);
    history.replaceState(null, "", `${window.location.pathname}?game=${data.id}`);
    clearComposer();
    setInspected(null);
    setOnlineSetup(false);
    adopt(data, { seat: data.seat, token: data.token });
    setCam((c) => ({ ...c, x: 0.5, y: H / 3 }));
    shareOnline(data.id);
  };

  const takeSeat = async (seat: number, name: string) => {
    if (!online) return;
    const { ok, data } = await api(`?id=${online.id}&op=seat`, { seat, name });
    if (!ok || !data.token) { toast.error(data.error ?? "Couldn't take that seat."); if (data.game) adopt(data); return; }
    writeSeat(online.id, seat, data.token);
    adopt(data, { seat, token: data.token });
    toast.success(`You're playing as ${data.game.players[seat].name}.`);
  };

  const leaveOnline = () => {
    setOnline(null);
    history.replaceState(null, "", window.location.pathname);
    let g: Game | null = null;
    try { g = parseStoredGame(localStorage.getItem(STORAGE_KEY)); } catch { /* storage blocked */ }
    setGame(g ?? defaultGame());
    clearComposer();
    setInspected(null);
  };

  const onlineUrl = (id: string) => `${window.location.origin}${window.location.pathname}?game=${id}`;
  const shareOnline = async (id: string) => {
    const url = onlineUrl(id);
    setShareUrl(url);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied. Send it to the other players; each takes a seat when they open it.");
    } catch {
      toast("Send the link below to the other players.");
    }
  };

  // Load: an online game, then a shared link, then this browser's saved game.
  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get("game");
    if (room) {
      joinRoom(room).then((ok) => {
        if (!ok) history.replaceState(null, "", window.location.pathname);
        setLoaded(true);
      });
      return;
    }
    let g: Game | null = null;
    const m = window.location.hash.match(/^#g=(.+)$/);
    if (m) {
      g = decodeGame(m[1]);
      if (g) toast.success("Loaded the shared game. Your move, if it's your turn.");
      else toast.error("That game link couldn't be read.");
      history.replaceState(null, "", window.location.pathname);
    }
    if (!g) {
      try { g = parseStoredGame(localStorage.getItem(STORAGE_KEY)); } catch { /* storage blocked */ }
    }
    if (g) {
      setGame(g);
      const [x, y] = centreOf(g);
      setCam((c) => ({ ...c, x, y }));
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded || online) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(game)); } catch { /* storage blocked */ }
  }, [game, loaded, online]);

  const clearComposer = () => {
    setSelected(null);
    setRoot([]);
    setArrIdx(0);
    setGloss("");
  };

  const place = useCallback(async () => {
    if (!selTri || !verdict?.ok || !preview) return;
    // With no meaning typed, take the dictionary's.
    const known = rootInfo?.senses.find((s) => !lang || s.lang === lang) ?? rootInfo?.senses[0];
    const meaning = gloss.trim() || known?.gloss || "";
    const language = lang || (!gloss.trim() && known ? known.lang : "");
    const before = starsOf(gameRef.current).length;
    const placed = await act({ type: "place", tri: tKey(selTri), root, corners: preview, gloss: meaning, ...(language ? { lang: language } : {}) });
    if (!placed) return;
    clearComposer();
    const made = starsOf(gameRef.current).length - before;
    if (made > 0) toast.success(`${made === 1 ? "A full point" : `${made} full points`}! All six triangles around a letter: +${STAR_BONUS * made}.`);
  }, [selTri, verdict, preview, root, gloss, lang, rootInfo, act]);

  const pass = () => {
    clearComposer();
    act({ type: "pass" });
  };

  const undo = async () => {
    if (!game.moves.length) return;
    const last = game.moves[game.moves.length - 1];
    clearComposer();
    setInspected(null);
    if (await act({ type: "undo" })) toast(`Took back ${rootText(last.root, game)}.`);
  };

  const addLetter = useCallback((l: string) => {
    setRoot((r) => (r.length < 3 ? [...r, l] : r));
    setArrIdx(0);
  }, []);

  // Typing: native script, Phoenician, or Latin transliteration.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (!selected || t.closest("input, textarea, select")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") clearComposer();
      else if (e.key === "Backspace") { setRoot((r) => r.slice(0, -1)); setArrIdx(0); e.preventDefault(); }
      else if (e.key === "Enter") { place(); e.preventDefault(); }
      else if (e.key === "Tab" && arrs.length > 1) { setArrIdx((i) => i + 1); e.preventDefault(); }
      else {
        const l = letterFromKey(e.key, game.alphabet);
        if (l) { addLetter(l); e.preventDefault(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, place, arrs.length, game.alphabet, addLetter]);

  const onTriClick = (tri: Tri) => {
    const k = tKey(tri);
    const claimedBy = board.claimed.get(k);
    if (claimedBy !== undefined) {
      setInspected(claimedBy);
      clearComposer();
      return;
    }
    setInspected(null);
    if (online && !myTurn) {
      toast(online.seat === null ? "You're watching. Take a free seat under Game to play." : `Waiting for ${current.name}.`);
      return;
    }
    const v = canPlayAt(game, board, tri);
    if (!v.ok) {
      toast(v.reason);
      return;
    }
    if (k !== selected) {
      setSelected(k);
      // On a phone the entry panel sits below the board: bring it into view.
      if (window.matchMedia("(max-width: 1023px)").matches)
        setTimeout(() => document.getElementById("composer")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      setRoot([]);
      setArrIdx(0);
      setGloss("");
    }
  };

  const focusMove = (i: number) => {
    const [x, y] = triCentroid(parseTri(game.moves[i].tri));
    setCam((c) => ({ ...c, x, y }));
    setInspected(i);
    clearComposer();
  };

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#g=${encodeGame(game)}`;
    setShareUrl(url);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied. Send it to your opponent; they play and send one back.");
    } catch {
      toast("Copy the link below and send it to your opponent.");
    }
  };

  const alphabetOf = (s: ScriptId) =>
    (Object.keys(ALPHABETS) as AlphabetId[]).find((a) => ALPHABETS[a].scripts.includes(s))!;

  // Scripts of the same alphabet redraw the board; the other alphabet needs a new game.
  const chooseScript = (s: ScriptId) => {
    const a = alphabetOf(s);
    if (a === game.alphabet) {
      setGame((g) => ({ ...g, script: s }));
      setPendingScript(null);
    } else if (online) {
      toast("An online game keeps its alphabet. Leave it to start a game in another script.");
    } else if (game.moves.length === 0) {
      startGame(a, game.players.map((p) => p.name), s);
    } else {
      setPendingScript(s);
    }
  };

  const startGame = (alphabet: AlphabetId, names: string[], script?: ScriptId) => {
    const g = { ...newGame(alphabet, names), ...(script ? { script } : {}) };
    if (onlineRef.current) { setOnline(null); history.replaceState(null, "", window.location.pathname); }
    setPendingScript(null);
    setGame(g);
    clearComposer();
    setInspected(null);
    setCam((c) => ({ ...c, x: 0.5, y: H / 3 }));
    setSetupOpen(false);
  };

  const sc = scoreboard(game);
  const fontFamily = SCRIPT_FONT[game.script];
  const letters = ALPHABETS[game.alphabet].letters;
  const needed = new Set((fixed ?? []).filter(Boolean) as string[]);
  const inspectedMove = inspected !== null ? game.moves[inspected] : null;

  return (
    <div className="bg-background text-foreground lg:h-[100dvh] lg:flex lg:overflow-hidden">
      {/* Board */}
      <div className="relative h-[55dvh] lg:h-auto lg:flex-1 border-b lg:border-b-0 lg:border-r border-border">
        <BoardView
          game={game}
          board={board}
          cam={cam}
          setCam={setCam}
          selected={selected}
          preview={preview}
          inspected={inspected}
          stars={stars}
          fontFamily={fontFamily}
          onTriClick={onTriClick}
        />
        {/* An epigraph for a fresh board; it leaves with the first root. Taps pass through. */}
        {loaded && game.moves.length === 0 && !selected && (
          <figure className="absolute right-14 max-w-[calc(100%-4.5rem)] text-right pointer-events-none select-none epigraph"
            style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
            <div className="inline-block rounded-xl px-3 py-2 sm:px-4 sm:py-3 bg-background/80 backdrop-blur-[2px]">
              <blockquote className="font-display italic text-sm sm:text-lg lg:text-xl leading-snug text-foreground/60">
                in the beginning was<br />the three-letter root<br />which unfolded like protein<br />ripe for diverse expression
              </blockquote>
              <figcaption className="mt-1.5 sm:mt-2 text-[9.5px] sm:text-[11px] tracking-wide text-muted-foreground font-body">
                — Josh Lipson, “Aqui fazem-se milagres, no metal”
              </figcaption>
            </div>
          </figure>
        )}
        <div style={{ top: "max(0.75rem, env(safe-area-inset-top))" }} className="absolute left-3 right-3 flex items-start justify-between pointer-events-none">
          <div className="pointer-events-auto bg-background/85 backdrop-blur rounded-md px-2.5 py-1.5 lg:px-3 lg:py-2 border border-border/60">
            <h1 className="font-display text-xl lg:text-2xl leading-tight">Semitic Triangles</h1>
            <a href="https://josh-lipson.com" target="_blank" rel="noopener noreferrer"
              className="block text-xs text-muted-foreground hover:text-foreground font-body">
              by Josh Lipson
            </a>
          </div>
        </div>
        <div className="absolute right-3 flex flex-col gap-1" style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          {[
            { icon: Plus, label: "Zoom in", fn: () => setCam((c) => ({ ...c, z: clampZ(c.z * 1.25) })) },
            { icon: Minus, label: "Zoom out", fn: () => setCam((c) => ({ ...c, z: clampZ(c.z / 1.25) })) },
            { icon: Crosshair, label: "Back to the game", fn: () => { const [x, y] = centreOf(game); setCam((c) => ({ ...c, x, y })); } },
          ].map(({ icon: Icon, label, fn }) => (
            <button key={label} onClick={fn} title={label} aria-label={label}
              className="w-9 h-9 grid place-items-center rounded-md bg-background/90 border border-border hover:bg-secondary">
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>
      </div>

      {/* Panel */}
      <aside className="lg:w-[380px] lg:overflow-y-auto font-body text-sm">
        <div className="p-5 space-y-6">
          {/* Players */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs tracking-[0.25em] uppercase text-primary">
                {online ? (myTurn ? "Your turn" : online.seat === null ? "Watching" : `${current.name}'s turn`) : game.players.length > 1 ? "Turn" : "Solo game"}
              </h2>
              <div className="flex gap-1">
                {game.players.length > 1 && myTurn && (
                  <button onClick={pass} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                    title="Can't think of a root? Hand over the pen. No record is kept of the fumble.">
                    <SkipForward className="w-3.5 h-3.5" /> Pass
                  </button>
                )}
                <button onClick={undo} disabled={!game.moves.length || (!!online && game.moves[game.moves.length - 1]?.player !== online.seat)}
                  className="flex items-center gap-1 px-2 py-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:pointer-events-none">
                  <Undo2 className="w-3.5 h-3.5" /> Undo
                </button>
              </div>
            </div>
            <ul className="space-y-1">
              {game.players.map((p, i) => {
                const active = i === game.turn % game.players.length;
                return (
                  <li key={i} className={`flex items-center gap-2 px-3 py-2 rounded border ${active ? "border-foreground/30 bg-secondary/60" : "border-transparent"}`}>
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: p.color }} />
                    <span className={`flex-1 ${active ? "font-medium" : "text-muted-foreground"}`}>{p.name}</span>
                    {online && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {online.seat === i ? "you" : online.seated.includes(i) ? "" : "open seat"}
                      </span>
                    )}
                    <span className="tabular-nums text-muted-foreground" title={`${sc[i].roots} roots, ${sc[i].stars} full points (+${STAR_BONUS} each)`}>
                      {sc[i].stars > 0 && <span className="inline-flex items-center gap-0.5 mr-2 text-foreground/80"><StarIcon className="w-3 h-3" />{sc[i].stars}</span>}
                      {sc[i].points} {sc[i].points === 1 ? "pt" : "pts"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Composer */}
          <section id="composer" className="rounded-lg border border-border p-4 bg-card scroll-mt-4">
            {selTri ? (
              <Composer
                game={game}
                root={root}
                setRoot={(r) => { setRoot(r); setArrIdx(0); }}
                addLetter={addLetter}
                letters={letters}
                needed={needed}
                fixed={fixed!}
                arrCount={arrs.length}
                arrIdx={arrIdx}
                cycle={() => setArrIdx((i) => i + 1)}
                gloss={gloss}
                setGloss={setGloss}
                lang={lang}
                setLang={setLang}
                rootInfo={rootInfo}
                lexReady={!!lex}
                useSense={(s: RootSense) => { setGloss(s.gloss); setLang(s.lang); }}
                rootIndex={rootIndex}
                used={used}
                words={words}
                loadWords={loadWords}
                verdict={verdict!}
                place={place}
                cancel={clearComposer}
                playerName={current.name}
                playerColor={current.color}
                fontFamily={fontFamily}
              />
            ) : inspectedMove ? (
              <div>
                <div className="flex items-start justify-between">
                  <p className="text-xs text-muted-foreground mb-1">
                    Root {inspected! + 1} · {game.players[inspectedMove.player]?.name}
                    {inspectedMove.lang && <> · {inspectedMove.lang}</>}
                  </p>
                  <button onClick={() => setInspected(null)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p dir={textDir(game.script)} className={`text-3xl ${textDir(game.script) === "rtl" ? "text-right" : "text-left"}`} style={{ fontFamily }}>{rootText(inspectedMove.root, game)}</p>
                <p className="text-muted-foreground mt-1">
                  {rootTranslit(inspectedMove.root, game)}
                  {inspectedMove.gloss && <> · <span className="italic text-foreground/80">{inspectedMove.gloss}</span></>}
                </p>
                <RootExplorer game={game} root={inspectedMove.root} rootIndex={rootIndex} words={words} loadWords={loadWords} fontFamily={fontFamily} open />
              </div>
            ) : (
              <p className="text-muted-foreground leading-relaxed">
                {online && !myTurn ? (
                  <>{online.seat === null ? "You're watching this game. Take a free seat below to play." : <>Waiting for <span className="font-medium text-foreground">{current.name}</span> to play. The board updates by itself.</>}</>
                ) : <>
                <span className="font-medium text-foreground">{online ? "Your turn" : current.name}</span>
                {game.moves.length === 0
                  ? ": tap any triangle to lay down the first root."
                  : ": tap a shaded triangle beside the letters to add a root."}
                </>}
                <span className="block mt-2 text-xs">Drag to move around, scroll or pinch to zoom. Tap a played root to explore its words.</span>
              </p>
            )}
          </section>

          {/* Moves */}
          {game.moves.length > 0 && (
            <section>
              <h2 className="text-xs tracking-[0.25em] uppercase text-primary mb-3">Roots played</h2>
              <ol className="space-y-0.5 max-h-72 overflow-y-auto pr-1">
                {[...game.moves].map((m, i) => ({ m, i })).reverse().map(({ m, i }) => (
                  <li key={i}>
                    <button onClick={() => focusMove(i)}
                      className={`w-full flex items-baseline gap-3 px-2 py-1.5 rounded text-left hover:bg-secondary/70 ${inspected === i ? "bg-secondary" : ""}`}>
                      <span className="w-6 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                      <span className="w-2 h-2 rounded-full shrink-0 self-center" style={{ background: game.players[m.player]?.color }} />
                      <span dir={textDir(game.script)} className="text-lg min-w-[4rem] text-right whitespace-nowrap shrink-0" style={{ fontFamily }}>{rootText(m.root, game)}</span>
                      <span className="text-muted-foreground truncate">
                        {rootTranslit(m.root, game)}{m.gloss && <span className="italic"> · {m.gloss}</span>}
                        {m.lang && <span className="ml-1.5 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-secondary text-muted-foreground not-italic">{m.lang}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Game controls */}
          <section className="space-y-3">
            <h2 className="text-xs tracking-[0.25em] uppercase text-primary">Game</h2>
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Script</p>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(ALPHABETS) as AlphabetId[]).map((a) => (
                  <div key={a} className="flex rounded-md border border-border overflow-hidden">
                    {ALPHABETS[a].scripts.map((s: ScriptId) => (
                      <button key={s} onClick={() => chooseScript(s)} aria-pressed={game.script === s}
                        className={`px-3 py-1.5 ${game.script === s ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-secondary/50"}`}>
                        {SCRIPT_LABEL[s]}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Paleo-Hebrew and Hebrew share a board, so you can switch between them mid-game. Syriac, Arabic and Ge'ez each have a board of their own.
              </p>
              {pendingScript && (
                <div className="mt-2 rounded-md border border-border p-3 space-y-2 bg-card">
                  <p>{SCRIPT_LABEL[pendingScript]} uses a different alphabet, so it needs a fresh board. This clears the current game ({game.moves.length} {game.moves.length === 1 ? "root" : "roots"}).</p>
                  <div className="flex gap-2">
                    <button onClick={() => startGame(alphabetOf(pendingScript), game.players.map((p) => p.name), pendingScript)}
                      className="flex-1 py-1.5 rounded-md bg-primary text-primary-foreground font-medium">
                      New {SCRIPT_LABEL[pendingScript]} game
                    </button>
                    <button onClick={() => setPendingScript(null)} className="px-3 py-1.5 rounded-md border border-border hover:bg-secondary">Cancel</button>
                  </div>
                </div>
              )}
            </div>
            {online ? (
              <OnlinePanel game={game} online={online} onShare={() => shareOnline(online.id)} onSeat={takeSeat} onLeave={leaveOnline} />
            ) : (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setOnlineSetup((o) => !o); setSetupOpen(false); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-medium">
                  <Globe className="w-3.5 h-3.5" /> Play online
                </button>
                <button onClick={share} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border hover:bg-secondary">
                  <Link2 className="w-3.5 h-3.5" /> Copy game link
                </button>
                <button onClick={() => { setSetupOpen((o) => !o); setOnlineSetup(false); }} className="px-3 py-1.5 rounded-md border border-border hover:bg-secondary">
                  New game
                </button>
              </div>
            )}
            {onlineSetup && !online && (
              <OnlineSetup game={game} onStart={startOnline} onCancel={() => setOnlineSetup(false)} />
            )}
            {shareUrl && (
              <div className="flex gap-1.5">
                <input id="share-url" readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()}
                  aria-label="Game link" className="flex-1 min-w-0 px-2 py-1.5 rounded border border-input bg-background text-xs" />
                <button onClick={() => setShareUrl(null)} aria-label="Hide link" className="px-2 rounded border border-border hover:bg-secondary">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {setupOpen && <Setup game={game} onStart={startGame} onCancel={() => setSetupOpen(false)} />}
          </section>

          {/* Rules */}
          <section>
            <details className="group" open={!loaded || game.moves.length === 0}>
              <summary className="cursor-pointer text-xs tracking-[0.25em] uppercase text-primary list-none flex items-center gap-2">
                <span className="transition-transform group-open:rotate-90">›</span> How to play
              </summary>
              <div className="mt-3 space-y-2 text-muted-foreground leading-relaxed">
                <p>Each triangle holds one three-letter Semitic root, one radical on each corner. Where six triangles meet at a point, they all share that letter.</p>
                <p>So a new root has to fit the letters already on its corners: one shared letter with every triangle it touches at a point, two with every triangle it shares a side with.</p>
                <p>Any root from any Semitic language is fair game: Hebrew, Aramaic, Arabic, Akkadian, Ge'ez and the rest, spelled in this game's alphabet. Tag each root with its language if you like. No root may be played twice. Stuck? Pass the pen; no record is kept of the fumble.</p>
                <p>Laying the sixth triangle around a letter completes a full point, worth {STAR_BONUS} extra points to whoever lays it.</p>
                <p>Playing alone, keep going until you drop. Playing apart, start an online game and send the link: everyone sees each move as it happens.</p>
                <p className="text-xs">
                  When a root is laid down, the game looks it up in Wiktionary (CC BY-SA 4.0, via kaikki.org), Brown–Driver–Briggs (Hebrew and Aramaic; digital edition by the Open Scriptures Hebrew Bible Project, CC BY 4.0) and Lane's <i>Arabic-English Lexicon</i> (text provided by Perseus Digital Library, with funding from The U.S. Department of Education and The Max Planck Society). Wiktionary also supplies a few dozen Ge'ez roots; on a Ge'ez board, other roots are looked up through their Hebrew and Arabic counterparts. A root missing from all of them is still fair: none covers Akkadian, Ugaritic or the rest.
                </p>
              </div>
            </details>
          </section>

          {/* About: the poem and the passage behind the game. */}
          <section>
            <details className="group">
              <summary className="cursor-pointer text-xs tracking-[0.25em] uppercase text-primary list-none flex items-center gap-2">
                <span className="transition-transform group-open:rotate-90">›</span> About the game
              </summary>
              <div className="mt-4 space-y-6 text-muted-foreground leading-relaxed">
                <figure>
                  <p className="font-display text-lg text-foreground mb-2">Aqui fazem-se milagres, no metal</p>
                  <div className="font-display text-base text-foreground/85 leading-snug space-y-3">
                    <p>In this trailer by the River Mondego,<br />miracles in metal<br />are blueprinted and set<br />in kludgy type—</p>
                    <p>in the beginning was<br />the three-letter root<br />which unfolded like protein<br />ripe for diverse expression—</p>
                    <p>a formless aleph<br />innocent of glottal dreams<br />trailing black copper slag<br />into the Dead Sea</p>
                  </div>
                  <figcaption className="mt-2 text-xs">— Josh Lipson, Coimbra, August 2017</figcaption>
                </figure>
                <figure className="border-l-2 border-primary/40 pl-4">
                  <blockquote className="font-display italic text-base text-foreground/85 leading-snug">
                    Namely, instead of the morphemes being placed linearly, one after the other before or after the word stem, as prefixes and suffixes, as in English, the morphemic structure of Semitic words is characterized by at least two morphemes interwoven (or interdigitated) within each other in a discontinuous (or non-concatenative) manner. One morpheme, the root, is inserted into the other (call it template, pattern, or scheme) in certain slots of the word stem structure. As two morphemes, the root and the template are incomplete in every respect, morphologically, phonologically, and semantically, until they merge to form a word or a word stem. Indeed roots and templates are both bound morphemes because only when a certain root and a certain template merge a definite word is completely specified phonologically, morphologically, and semantically.
                  </blockquote>
                  <figcaption className="mt-2 text-xs">— Joseph Shimron, “Semitic Languages: Are They Really Root-Based?”</figcaption>
                </figure>
                <p>
                  The game began on Thanksgiving 2015, in a notebook, on a walk through Central Jersey.{" "}
                  <a href={ESSAY_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    Read the essay behind it <ExternalLink className="w-3 h-3" />
                  </a>
                </p>
              </div>
            </details>
          </section>
        </div>
      </aside>
    </div>
  );
};

// ==================================================================== board

type BoardProps = {
  game: Game;
  board: ReturnType<typeof boardOf>;
  cam: Camera;
  setCam: React.Dispatch<React.SetStateAction<Camera>>;
  selected: string | null;
  preview: string[] | null;
  inspected: number | null;
  stars: ReturnType<typeof starsOf>;
  fontFamily: string;
  onTriClick: (t: Tri) => void;
};

const BoardView = ({ game, board, cam, setCam, selected, preview, inspected, stars, fontFamily, onTriClick }: BoardProps) => {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hover, setHover] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: 0, pinch: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toWorld = useCallback((px: number, py: number, c: Camera) => {
    const rect = ref.current!.getBoundingClientRect();
    return [c.x + (px - rect.left - rect.width / 2) / c.z, c.y + (py - rect.top - rect.height / 2) / c.z] as const;
  }, []);

  // Wheel zoom about the cursor (needs a non-passive listener).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setCam((c) => {
        const z = clampZ(c.z * Math.exp(-e.deltaY * 0.0015));
        const [wx, wy] = toWorld(e.clientX, e.clientY, c);
        return { x: wx - (wx - c.x) * (c.z / z), y: wy - (wy - c.y) * (c.z / z), z };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setCam, toWorld]);

  const onPointerDown = (e: React.PointerEvent) => {
    ref.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = { moved: 0, pinch: 0 };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current.moved = 99; // never a tap
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse") {
        const [wx, wy] = toWorld(e.clientX, e.clientY, cam);
        setHover(tKey(triAt(wx, wy)));
      }
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      gesture.current.moved += Math.abs(dx) + Math.abs(dy);
      if (gesture.current.moved > 6) setCam((c) => ({ ...c, x: c.x - dx / c.z, y: c.y - dy / c.z }));
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const ratio = d / (gesture.current.pinch || d);
      gesture.current.pinch = d;
      setCam((c) => {
        const z = clampZ(c.z * ratio);
        const [wx, wy] = toWorld(mx, my, c);
        return { x: wx - (wx - c.x) * (c.z / z) - dx / 2 / z, y: wy - (wy - c.y) * (c.z / z) - dy / 2 / z, z };
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wasTap = pointers.current.size === 1 && gesture.current.moved <= 6;
    pointers.current.delete(e.pointerId);
    if (wasTap) {
      const [wx, wy] = toWorld(e.clientX, e.clientY, cam);
      onTriClick(triAt(wx, wy));
    }
  };

  // Visible world rectangle, padded by a cell.
  const vw = size.w / cam.z, vh = size.h / cam.z;
  const x0 = cam.x - vw / 2 - 1, x1 = cam.x + vw / 2 + 1;
  const y0 = cam.y - vh / 2 - 1, y1 = cam.y + vh / 2 + 1;
  const k = 1 / Math.sqrt(3);

  // Grid: three families of parallel lines.
  const lines: string[] = [];
  for (let r = Math.floor(y0 / H); r <= Math.ceil(y1 / H); r++) lines.push(`M${x0} ${r * H}H${x1}`);
  const qMin = Math.floor(x0 - y1 * k), qMax = Math.ceil(x1 - y0 * k);
  for (let q = qMin; q <= qMax; q++) lines.push(`M${q + y0 * k} ${y0}L${q + y1 * k} ${y1}`);
  const sMin = Math.floor(x0 + y0 * k), sMax = Math.ceil(x1 + y1 * k);
  for (let s = sMin; s <= sMax; s++) lines.push(`M${s - y0 * k} ${y0}L${s - y1 * k} ${y1}`);

  const triPath = (key: string) => {
    const ps = triVerts(parseTri(key)).map(vPos);
    return `M${ps[0][0]} ${ps[0][1]}L${ps[1][0]} ${ps[1][1]}L${ps[2][0]} ${ps[2][1]}Z`;
  };

  // Letters sit just inside each corner, as in the notebook: a point shared
  // by six triangles shows its letter six times around it.
  const cornerLetters = (key: string, corners: (string | null)[], opts: { fill: string; opacity?: number }) => {
    const t = parseTri(key);
    const [cx, cy] = triCentroid(t);
    return triVerts(t).map((v, j) => {
      const l = corners[j];
      if (!l) return null;
      const [vx, vy] = vPos(v);
      return (
        <text key={`${key}-${j}`} x={vx + (cx - vx) * 0.34} y={vy + (cy - vy) * 0.34}
          fontSize={0.2} textAnchor="middle" dominantBaseline="central"
          fill={opts.fill} opacity={opts.opacity ?? 1} style={{ fontFamily }}>
          {glyph(l, game.script)}
        </text>
      );
    });
  };

  const first = game.moves.length === 0;
  const playableHover = hover && !board.claimed.has(hover) && (first || board.open.has(hover)) && hover !== selected;
  const selFixed = selected ? fixedCorners(board, parseTri(selected)) : null;

  return (
    <svg
      ref={ref}
      className="w-full h-full block select-none cursor-grab active:cursor-grabbing"
      style={{ touchAction: "none" }}
      viewBox={`${cam.x - vw / 2} ${cam.y - vh / 2} ${vw} ${vh}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
      onPointerLeave={() => setHover(null)}
      role="application"
      aria-label="Semitic Triangles board"
    >
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="hsl(var(--background))" />

      {/* Open triangles: where the next root can go. */}
      {[...board.open].map((key) => (
        <path key={key} d={triPath(key)} fill="hsl(var(--primary))" opacity={0.06} />
      ))}

      {/* Claimed triangles. */}
      {game.moves.map((m, i) => (
        <path key={m.tri} d={triPath(m.tri)} fill={game.players[m.player]?.color ?? "#888"}
          opacity={inspected === i ? 0.28 : 0.11} />
      ))}

      {playableHover && <path d={triPath(hover!)} fill="hsl(var(--primary))" opacity={0.12} />}

      <path d={lines.join("")} stroke="hsl(var(--foreground))" strokeOpacity={0.22}
        strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />

      {selected && (
        <path d={triPath(selected)} fill="hsl(var(--primary))" fillOpacity={0.14}
          stroke="hsl(var(--primary))" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      )}

      {/* Full points: a six-pointed star behind each completed letter. */}
      {stars.map((st) => {
        const [q, r] = st.vertex.split(",").map(Number);
        const [x, y] = vPos([q, r]);
        const pts = Array.from({ length: 12 }, (_, i) => {
          const a = (Math.PI / 6) * i - Math.PI / 2;
          const rad = i % 2 ? 0.075 : 0.15;
          return `${x + rad * Math.cos(a)},${y + rad * Math.sin(a)}`;
        }).join(" ");
        return <polygon key={st.vertex} points={pts} fill={game.players[st.player]?.color ?? "#888"} opacity={0.85} />;
      })}

      {/* Points that carry a letter. */}
      {[...board.letters.keys()].map((vk) => {
        const [q, r] = vk.split(",").map(Number);
        const [x, y] = vPos([q, r]);
        return <circle key={vk} cx={x} cy={y} r={0.025} fill="hsl(var(--foreground))" opacity={0.6} />;
      })}

      {game.moves.map((m, i) => {
        const [cx, cy] = triCentroid(parseTri(m.tri));
        return (
          <g key={m.tri}>
            {cornerLetters(m.tri, m.corners, { fill: "hsl(var(--foreground))" })}
            <text x={cx} y={cy} fontSize={0.09} textAnchor="middle" dominantBaseline="central"
              fill="hsl(var(--muted-foreground))" opacity={0.7} style={{ fontFamily: "Inter, sans-serif" }}>
              {i + 1}
            </text>
          </g>
        );
      })}

      {/* What the root being composed would look like. */}
      {selected && selFixed && cornerLetters(selected, preview ?? selFixed, { fill: "hsl(var(--primary))", opacity: preview ? 0.9 : 0.6 })}
    </svg>
  );
};

// ================================================================= composer

type ComposerProps = {
  game: Game;
  root: string[];
  setRoot: (r: string[]) => void;
  addLetter: (l: string) => void;
  letters: { id: string; translit: string }[];
  needed: Set<string>;
  fixed: (string | null)[];
  arrCount: number;
  arrIdx: number;
  cycle: () => void;
  gloss: string;
  setGloss: (s: string) => void;
  lang: string;
  setLang: (s: string) => void;
  rootInfo: ReturnType<typeof lookupRoot> | null;
  lexReady: boolean;
  useSense: (s: RootSense) => void;
  rootIndex: RootIndex | null;
  used: Set<string>;
  words: { he: WordList | null; ar: WordList | null } | null;
  loadWords: () => void;
  verdict: { ok: boolean; reason?: string };
  place: () => void;
  cancel: () => void;
  playerName: string;
  playerColor: string;
  fontFamily: string;
};

const Composer = (p: ComposerProps) => {
  const { game, root, fontFamily } = p;
  const neededList = p.fixed.filter(Boolean) as string[];
  const full = root.length === 3;
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.playerColor }} />
            {p.playerName}, name a root
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {neededList.length === 0
              ? "Any root will do."
              : neededList.length === 3
                ? "All three corners are set: name the root they spell, in any order."
                : <>It must contain <span style={{ fontFamily }} className="text-base text-foreground">{neededList.map((l) => glyph(l, game.script)).join(" ")}</span>.</>}
          </p>
        </div>
        <button onClick={p.cancel} aria-label="Cancel" className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Three radical slots, first radical on the right. */}
      <div dir={textDir(game.script)} className="flex gap-2 justify-center">
        {[0, 1, 2].map((i) => (
          <button key={i} onClick={() => p.setRoot(root.slice(0, i))}
            className={`w-16 h-16 rounded-md border-2 grid place-items-center text-3xl transition-colors ${
              i === root.length ? "border-primary" : root[i] ? "border-border bg-secondary/40" : "border-dashed border-border"}`}
            style={{ fontFamily }} title={root[i] ? "Clear from here" : undefined}>
            {root[i] ? glyph(root[i], game.script) : ""}
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground -mt-2 h-4">
        {root.length > 0 && rootTranslit(root, game)}
      </p>

      {/* Letter keys. */}
      <div dir={textDir(game.script)} className="flex flex-wrap justify-center gap-1">
        {p.letters.map((l) => (
          <button key={l.id} onClick={() => p.addLetter(l.id)} disabled={full}
            className={`w-[calc((100%-1.5rem)/7)] rounded border py-1 leading-none flex flex-col items-center gap-0.5 hover:bg-secondary disabled:opacity-40 ${
              p.needed.has(l.id) ? "border-primary/60 bg-primary/5" : "border-border"}`}>
            <span className="text-xl" style={{ fontFamily }}>{glyph(l.id, game.script)}</span>
            <span className="text-[10px] text-muted-foreground" dir="ltr">{l.translit}</span>
          </button>
        ))}
      </div>

      {!full && p.rootIndex && <Hints p={p} />}

      {full && p.lexReady && p.rootInfo && <RootNotes p={p} />}

      {full && p.arrCount > 1 && (
        <button onClick={p.cycle} className="w-full flex items-center justify-center gap-2 py-1.5 rounded-md border border-border hover:bg-secondary">
          <RotateCw className="w-3.5 h-3.5" /> Turn it on the board ({(p.arrIdx % p.arrCount) + 1} of {p.arrCount})
        </button>
      )}

      <div className="flex gap-2">
        <input id="root-gloss" value={p.gloss} onChange={(e) => p.setGloss(e.target.value)} placeholder="Meaning (optional)"
          aria-label="Meaning" className="flex-1 min-w-0 px-3 py-2 rounded-md border border-input bg-background text-sm"
          onKeyDown={(e) => { if (e.key === "Enter") p.place(); }} />
        <select id="root-lang" value={p.lang} onChange={(e) => p.setLang(e.target.value)} aria-label="Language the root comes from"
          className={`w-32 px-2 py-2 rounded-md border border-input bg-background text-sm ${p.lang ? "" : "text-muted-foreground"}`}>
          <option value="">Language</option>
          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      {full && !p.verdict.ok && <p className="text-destructive text-xs">{p.verdict.reason}</p>}

      <div className="flex gap-2">
        <button onClick={p.place} disabled={!p.verdict.ok}
          className="flex-1 py-2 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-40">
          Place root
        </button>
        <button onClick={() => p.setRoot(root.slice(0, -1))} disabled={!root.length}
          className="px-3 py-2 rounded-md border border-border hover:bg-secondary disabled:opacity-40">
          ⌫
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Keyboard: type in Hebrew, Syriac, Arabic or Ethiopic (any works in any game){LATIN_HINT[game.alphabet] && <>, or Latin ({LATIN_HINT[game.alphabet]})</>}. Enter places, Tab turns, Esc cancels.
      </p>
    </div>
  );
};

// ==================================================================== setup

const Setup = ({ game, onStart, onCancel }: { game: Game; onStart: (a: AlphabetId, names: string[]) => void; onCancel: () => void }) => {
  const [alphabet, setAlphabet] = useState<AlphabetId>(game.alphabet);
  const [names, setNames] = useState<string[]>(game.players.map((p) => p.name));
  const [confirming, setConfirming] = useState(false);
  const start = () => {
    if (game.moves.length && !confirming) {
      setConfirming(true);
      return;
    }
    onStart(alphabet, names.map((n, i) => n.trim() || `Player ${i + 1}`));
  };
  return (
    <div className="rounded-lg border border-border p-4 space-y-4 bg-card">
      <div>
        <p className="text-xs text-muted-foreground mb-2">Alphabet</p>
        <div className="flex flex-col gap-1">
          {(Object.keys(ALPHABETS) as AlphabetId[]).map((a) => (
            <label key={a} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="alphabet" checked={alphabet === a} onChange={() => setAlphabet(a)} />
              {ALPHABETS[a].label}
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-2">Players</p>
        <div className="space-y-1.5">
          {names.map((n, i) => (
            <div key={i} className="flex gap-1.5">
              <input value={n} onChange={(e) => setNames(names.map((m, j) => (j === i ? e.target.value : m)))}
                className="flex-1 px-2 py-1.5 rounded border border-input bg-background" aria-label={`Player ${i + 1} name`} />
              {names.length > 1 && (
                <button onClick={() => setNames(names.filter((_, j) => j !== i))} aria-label="Remove player"
                  className="px-2 rounded border border-border hover:bg-secondary"><X className="w-3.5 h-3.5" /></button>
              )}
            </div>
          ))}
          {names.length < 4 && (
            <button onClick={() => setNames([...names, `Player ${names.length + 1}`])} className="text-xs text-primary hover:underline">
              + Add player
            </button>
          )}
        </div>
      </div>
      {confirming && (
        <p className="text-xs text-destructive">This clears the current board ({game.moves.length} {game.moves.length === 1 ? "root" : "roots"}). Undo can't bring it back.</p>
      )}
      <div className="flex gap-2">
        <button onClick={start} className="flex-1 py-2 rounded-md bg-primary text-primary-foreground font-medium">
          {confirming ? "Clear the board and start" : "Start"}
        </button>
        <button onClick={onCancel} className="px-3 py-2 rounded-md border border-border hover:bg-secondary">Cancel</button>
      </div>
    </div>
  );
};

export default App;

// What the dictionary says about the root being composed.
const RootNotes = ({ p }: { p: ComposerProps }) => {
  const { senses, otherOrders } = p.rootInfo!;
  const { game, fontFamily } = p;
  return (
    <div className="rounded-md bg-secondary/50 px-3 py-2.5 space-y-2 text-xs">
      {senses.length ? (
        <div className="space-y-1">
          <p className="text-muted-foreground">In the dictionary · tap to use</p>
          {senses.map((s) => (
            <button key={s.lang} onClick={() => p.useSense(s)}
              className={`block w-full text-left rounded px-1.5 py-1 hover:bg-background/70 ${p.gloss === s.gloss ? "bg-background/70" : ""}`}>
              <span className="uppercase tracking-wider text-[10px] text-muted-foreground mr-1.5">{s.lang}</span>
              <span className="text-foreground/90">{s.gloss}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">
          Not in the dictionaries. Still fair if it comes from another Semitic language: add its meaning and language below.
        </p>
      )}
      <RootExplorer game={game} root={p.root} rootIndex={p.rootIndex} words={p.words} loadWords={p.loadWords} fontFamily={fontFamily} />
      {otherOrders.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-border/60">
          <p className="text-muted-foreground">Same letters, other roots · tap to switch</p>
          {otherOrders.slice(0, 4).map((o) => (
            <button key={o.root.join("")} onClick={() => p.setRoot(o.root)}
              className="flex w-full items-baseline gap-2 text-left rounded px-1.5 py-1 hover:bg-background/70">
              <span dir={textDir(game.script)} className="text-base shrink-0" style={{ fontFamily }}>{o.root.map((l) => glyph(l, game.script)).join(" ")}</span>
              <span className="text-muted-foreground shrink-0">{rootTranslit(o.root, game)}</span>
              <span className="truncate text-foreground/80">{o.senses[0].gloss}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// "Stuck?": dictionary roots that would fit the chosen triangle.
const Hints = ({ p }: { p: ComposerProps }) => {
  const [open, setOpen] = useState(false);
  const { game, fontFamily } = p;
  const hints = useMemo(() => (open && p.rootIndex ? hintsFor(p.rootIndex, p.fixed, p.used) : []), [open, p.rootIndex, p.fixed, p.used]);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
        <Lightbulb className="w-3.5 h-3.5" /> Stuck? Show roots that fit
      </button>
    );
  return (
    <div className="rounded-md bg-secondary/50 px-3 py-2.5 space-y-1 text-xs">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground">Roots that fit here · tap to use</p>
        <button onClick={() => setOpen(false)} aria-label="Hide hints" className="text-muted-foreground hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
      </div>
      {hints.length === 0 && <p className="text-muted-foreground">The dictionary has nothing unplayed for these letters. Try a root from another language, or pass.</p>}
      {hints.map((h) => (
        <button key={h.root.join("")} onClick={() => p.setRoot(h.root)}
          className="flex w-full items-baseline gap-2 text-left rounded px-1.5 py-1 hover:bg-background/70">
          <span dir={textDir(game.script)} className="text-base shrink-0" style={{ fontFamily }}>{h.root.map((l) => glyph(l, game.script)).join(" ")}</span>
          <span className="text-muted-foreground shrink-0">{rootTranslit(h.root, game)}</span>
          <span className="truncate text-foreground/80">{h.senses[0].gloss}</span>
        </button>
      ))}
    </div>
  );
};

// The family of a root: what it means in each language, and words built on it.
const RootExplorer = ({ game, root, rootIndex, words, loadWords, fontFamily, open: startOpen = false }: {
  game: Game; root: string[]; rootIndex: RootIndex | null;
  words: { he: WordList | null; ar: WordList | null } | null; loadWords: () => void; fontFamily: string; open?: boolean;
}) => {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => { if (open) loadWords(); }, [open, loadWords]);
  useEffect(() => { setOpen(startOpen); }, [root.join(""), startOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
        <BookOpen className="w-3.5 h-3.5" /> Words from this root
      </button>
    );
  const senses = rootIndex ? lookupRoot(rootIndex, root).senses : [];
  const loading = !words || (!words.he && !words.ar);
  const families = words ? wordsFor(words.he, words.ar, game.alphabet, root) : [];
  return (
    <div className="mt-3 space-y-3 text-xs">
      {senses.length > 0 && (
        <div className="space-y-0.5">
          {senses.map((s) => (
            <p key={s.lang}><span className="uppercase tracking-wider text-[10px] text-muted-foreground mr-1.5">{s.lang}</span>{s.gloss}</p>
          ))}
        </div>
      )}
      {loading ? (
        <p className="text-muted-foreground">Loading words…</p>
      ) : families.length === 0 ? (
        <p className="text-muted-foreground">No words from this root in the Hebrew or Arabic word lists.</p>
      ) : (
        families.map((f) => (
          <div key={f.lang}>
            <p className="uppercase tracking-wider text-[10px] text-muted-foreground mb-1">{f.lang} words</p>
            <ul className="space-y-1">
              {f.words.map(([w, rom, pos, gl]) => (
                <li key={w + pos} className="flex items-baseline gap-2">
                  <span dir="rtl" className="text-base shrink-0" style={{ fontFamily: f.lang === "Arabic" ? SCRIPT_FONT.arabic : SCRIPT_FONT.hebrew }}>{w}</span>
                  <span className="text-muted-foreground shrink-0 italic">{rom}</span>
                  <span className="text-foreground/80 min-w-0">{gl}</span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {!loading && <p className="text-[10px] text-muted-foreground">Words and meanings from Wiktionary (CC BY-SA 4.0).</p>}
      {!startOpen && (
        <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">Hide words</button>
      )}
    </div>
  );
};

// Starting an online game: who's playing.
const OnlineSetup = ({ game, onStart, onCancel }: { game: Game; onStart: (names: string[]) => Promise<void>; onCancel: () => void }) => {
  const [names, setNames] = useState<string[]>(game.players.length >= 2 ? game.players.map((p) => p.name) : ["Player 1", "Player 2"]);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-lg border border-border p-4 space-y-3 bg-card">
      <p className="text-muted-foreground text-xs leading-relaxed">
        Starts a fresh {ALPHABETS[game.alphabet].label.replace(/ \(\d+\)$/, "")} board online. You take the first seat; send the link and each friend takes one of the others. Your game on this device stays saved.
      </p>
      <div className="space-y-1.5">
        {names.map((n, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: ["#b5532f", "#3d5a80", "#6b7d2a", "#8a4f7d"][i] }} />
            <input id={`online-name-${i}`} value={n} onChange={(e) => setNames(names.map((m, j) => (j === i ? e.target.value : m)))}
              className="flex-1 px-2 py-1.5 rounded border border-input bg-background" aria-label={i === 0 ? "Your name" : `Player ${i + 1} name`} />
            {i === 0 && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">you</span>}
            {names.length > 2 && i > 0 && (
              <button onClick={() => setNames(names.filter((_, j) => j !== i))} aria-label="Remove player"
                className="px-2 py-1.5 rounded border border-border hover:bg-secondary"><X className="w-3.5 h-3.5" /></button>
            )}
          </div>
        ))}
        {names.length < 4 && (
          <button onClick={() => setNames([...names, `Player ${names.length + 1}`])} className="text-xs text-primary hover:underline">+ Add player</button>
        )}
      </div>
      <div className="flex gap-2">
        <button disabled={busy} onClick={async () => { setBusy(true); await onStart(names.map((n, i) => n.trim() || `Player ${i + 1}`)); setBusy(false); }}
          className="flex-1 py-2 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-50">
          {busy ? "Starting…" : "Start online game"}
        </button>
        <button onClick={onCancel} className="px-3 py-2 rounded-md border border-border hover:bg-secondary">Cancel</button>
      </div>
    </div>
  );
};

// An online game in progress: the link, the seats, and the way out.
const OnlinePanel = ({ game, online, onShare, onSeat, onLeave }: {
  game: Game; online: Online; onShare: () => void; onSeat: (seat: number, name: string) => void; onLeave: () => void;
}) => {
  const free = game.players.map((_, i) => i).filter((i) => !online.seated.includes(i));
  const [name, setName] = useState("");
  return (
    <div className="rounded-lg border border-border p-4 space-y-3 bg-card">
      <p className="flex items-center gap-1.5 font-medium"><Globe className="w-3.5 h-3.5 text-primary" /> Online game</p>
      {online.seat === null && free.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Take a free seat to play:</p>
          <input id="seat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
            className="w-full px-2 py-1.5 rounded border border-input bg-background" aria-label="Your name" />
          <div className="flex flex-wrap gap-1.5">
            {free.map((i) => (
              <button key={i} onClick={() => onSeat(i, name)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border hover:bg-secondary">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: game.players[i].color }} /> Play as {game.players[i].name}
              </button>
            ))}
          </div>
        </div>
      )}
      {online.seat === null && free.length === 0 && <p className="text-xs text-muted-foreground">Every seat is taken, so you're watching.</p>}
      {online.seat !== null && free.length > 0 && (
        <p className="text-xs text-muted-foreground">Waiting for {free.map((i) => game.players[i].name).join(" and ")} to open the link and take a seat.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button onClick={onShare} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border hover:bg-secondary">
          <Link2 className="w-3.5 h-3.5" /> Copy invite link
        </button>
        <button onClick={onLeave} className="px-3 py-1.5 rounded-md border border-border hover:bg-secondary">Back to my game</button>
      </div>
      <p className="text-[11px] text-muted-foreground">The link brings anyone back to this board. Your seat is remembered on this device.</p>
    </div>
  );
};
