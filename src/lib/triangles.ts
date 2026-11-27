// Semitic Triangles: board geometry, alphabets and rules.
//
// The board is an endless lattice of equilateral triangles. Every lattice
// point (vertex) holds one consonant; every triangle holds one three-letter
// root, its letters sitting on the triangle's three corners. Because corners
// are shared, a letter written at a point belongs to all six triangles that
// meet there, and two triangles that share a side share two letters.

// ---------------------------------------------------------------- geometry

/** Height of an equilateral triangle with unit sides. */
export const H = Math.sqrt(3) / 2;

/** Vertex (q, r) in axial lattice coordinates. */
export type Vertex = readonly [number, number];
/** Triangle: k = 0 points down (flat top), k = 1 points up (flat bottom). */
export type Tri = readonly [number, number, 0 | 1];

export const vKey = ([q, r]: Vertex) => `${q},${r}`;
export const tKey = ([q, r, k]: Tri) => `${q},${r},${k}`;
export const parseTri = (key: string): Tri => {
  const [q, r, k] = key.split(",").map(Number);
  return [q, r, k as 0 | 1];
};

/** The three corners of a triangle, in a fixed order. */
export const triVerts = ([q, r, k]: Tri): [Vertex, Vertex, Vertex] =>
  k === 0
    ? [[q, r], [q + 1, r], [q, r + 1]]
    : [[q + 1, r], [q + 1, r + 1], [q, r + 1]];

/** The six triangles that meet at a vertex. */
export const trisAround = ([q, r]: Vertex): Tri[] => [
  [q, r, 0], [q - 1, r, 0], [q, r - 1, 0],
  [q - 1, r, 1], [q, r - 1, 1], [q - 1, r - 1, 1],
];

/** World position of a vertex (unit side length, y grows downward). */
export const vPos = ([q, r]: Vertex): [number, number] => [q + r / 2, r * H];

export const triCentroid = (t: Tri): [number, number] => {
  const ps = triVerts(t).map(vPos);
  return [(ps[0][0] + ps[1][0] + ps[2][0]) / 3, (ps[0][1] + ps[1][1] + ps[2][1]) / 3];
};

/** Which triangle contains a world point. */
export const triAt = (x: number, y: number): Tri => {
  const rf = y / H;
  const qf = x - rf / 2;
  const q = Math.floor(qf);
  const r = Math.floor(rf);
  return [q, r, qf - q + (rf - r) < 1 ? 0 : 1];
};

// --------------------------------------------------------------- alphabets

export type AlphabetId = "canaanite" | "syriac" | "arabic";
export type ScriptId = "hebrew" | "paleo" | "syriac" | "arabic";

type Letter = { id: string; translit: string; keys?: string[] };

// Letters are stored by their square-Hebrew form (or Arabic form), and
// drawn in the game's script. Paleo-Hebrew/Phoenician, square Hebrew and
// Syriac are the same 22-letter alphabet in the same order. Paleo-Hebrew
// and square Hebrew share a board and can be swapped mid-game; Syriac is
// played on a board of its own.
const CANAANITE: Letter[] = [
  { id: "א", translit: "ʾ", keys: ["a", "'"] },
  { id: "ב", translit: "b", keys: ["b"] },
  { id: "ג", translit: "g", keys: ["g"] },
  { id: "ד", translit: "d", keys: ["d"] },
  { id: "ה", translit: "h", keys: ["h"] },
  { id: "ו", translit: "w", keys: ["w", "v"] },
  { id: "ז", translit: "z", keys: ["z"] },
  { id: "ח", translit: "ḥ", keys: ["x", "H"] },
  { id: "ט", translit: "ṭ", keys: ["T"] },
  { id: "י", translit: "y", keys: ["y", "i", "j"] },
  { id: "כ", translit: "k", keys: ["k"] },
  { id: "ל", translit: "l", keys: ["l"] },
  { id: "מ", translit: "m", keys: ["m"] },
  { id: "נ", translit: "n", keys: ["n"] },
  { id: "ס", translit: "s", keys: ["s"] },
  { id: "ע", translit: "ʿ", keys: ["e", "`"] },
  { id: "פ", translit: "p", keys: ["p", "f"] },
  { id: "צ", translit: "ṣ", keys: ["c"] },
  { id: "ק", translit: "q", keys: ["q"] },
  { id: "ר", translit: "r", keys: ["r"] },
  { id: "ש", translit: "š", keys: ["S", "$"] },
  { id: "ת", translit: "t", keys: ["t"] },
];

const PHOENICIAN = Array.from({ length: 22 }, (_, i) => String.fromCodePoint(0x10900 + i));

// ʾālap̄ to taw, skipping the Unicode block's extra letters.
const SYRIAC = [
  0x710, 0x712, 0x713, 0x715, 0x717, 0x718, 0x719, 0x71a, 0x71b, 0x71d, 0x71f,
  0x720, 0x721, 0x722, 0x723, 0x725, 0x726, 0x728, 0x729, 0x72a, 0x72b, 0x72c,
].map((c) => String.fromCodePoint(c));

const CANAANITE_GLYPHS: Partial<Record<ScriptId, string[]>> = { paleo: PHOENICIAN, syriac: SYRIAC };

const ARABIC: Letter[] = [
  ["ء", "ʾ"], ["ب", "b"], ["ت", "t"], ["ث", "ṯ"], ["ج", "j"], ["ح", "ḥ"], ["خ", "ḫ"],
  ["د", "d"], ["ذ", "ḏ"], ["ر", "r"], ["ز", "z"], ["س", "s"], ["ش", "š"], ["ص", "ṣ"],
  ["ض", "ḍ"], ["ط", "ṭ"], ["ظ", "ẓ"], ["ع", "ʿ"], ["غ", "ġ"], ["ف", "f"], ["ق", "q"],
  ["ك", "k"], ["ل", "l"], ["م", "m"], ["ن", "n"], ["ه", "h"], ["و", "w"], ["ي", "y"],
].map(([id, translit]) => ({ id, translit }));

export const ALPHABETS: Record<AlphabetId, { label: string; letters: Letter[]; scripts: ScriptId[] }> = {
  canaanite: { label: "Paleo-Hebrew & Hebrew (22)", letters: CANAANITE, scripts: ["paleo", "hebrew"] },
  syriac: { label: "Syriac (22)", letters: CANAANITE, scripts: ["syriac"] },
  arabic: { label: "Arabic (28)", letters: ARABIC, scripts: ["arabic"] },
};

export const SCRIPT_LABEL: Record<ScriptId, string> = {
  paleo: "Paleo-Hebrew",
  hebrew: "Hebrew",
  syriac: "Syriac",
  arabic: "Arabic",
};

export const SCRIPT_FONT: Record<ScriptId, string> = {
  paleo: "'Noto Sans Phoenician', 'Segoe UI Historic', sans-serif",
  hebrew: "'Noto Serif Hebrew', 'Times New Roman', serif",
  syriac: "'Noto Sans Syriac', 'Estrangelo Edessa', sans-serif",
  arabic: "'Noto Naskh Arabic', 'Noto Sans Arabic', serif",
};

/** How a stored letter is drawn in a script. */
export const glyph = (id: string, script: ScriptId) => {
  const glyphs = CANAANITE_GLYPHS[script];
  if (!glyphs) return id;
  const i = CANAANITE.findIndex((l) => l.id === id);
  return i < 0 ? id : glyphs[i];
};

export const translit = (id: string, alphabet: AlphabetId) =>
  ALPHABETS[alphabet].letters.find((l) => l.id === id)?.translit ?? id;

const HEBREW_FINALS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };
const ARABIC_VARIANTS: Record<string, string> = { ا: "ء", أ: "ء", إ: "ء", آ: "ء", ؤ: "ء", ئ: "ء", ى: "ي", ة: "ت" };

// Roots from any Semitic language are fair game in any alphabet, so a
// keyboard in one script can type into a game in the other.
// Arabic into the 22: by cognate, so س becomes ש (salām, šālôm), and
// Arabic's six extra letters fold into their usual Hebrew counterparts.
export const ARABIC_TO_CANAANITE: Record<string, string> = {
  ء: "א", ب: "ב", ج: "ג", د: "ד", ه: "ה", و: "ו", ز: "ז", ح: "ח", ط: "ט", ي: "י",
  ك: "כ", ل: "ל", م: "מ", ن: "נ", س: "ש", ع: "ע", ف: "פ", ص: "צ", ق: "ק", ر: "ר",
  ش: "ש", ت: "ת", ث: "ש", خ: "ח", ذ: "ז", ض: "צ", ظ: "צ", غ: "ע",
};
// The 22 into Arabic: the abjad correspondences.
export const CANAANITE_TO_ARABIC: Record<string, string> = {
  א: "ء", ב: "ب", ג: "ج", ד: "د", ה: "ه", ו: "و", ז: "ز", ח: "ح", ט: "ط", י: "ي",
  כ: "ك", ל: "ل", מ: "م", נ: "ن", ס: "س", ע: "ع", פ: "ف", צ: "ص", ק: "ق", ר: "ر",
  ש: "ش", ת: "ت",
};

/** Typed Hebrew, Paleo-Hebrew or Syriac as a 22-letter id, if it is one. */
const canaaniteFromGlyph = (key: string): string | null => {
  const k = HEBREW_FINALS[key] ?? key;
  if (CANAANITE.some((l) => l.id === k)) return k;
  for (const glyphs of Object.values(CANAANITE_GLYPHS)) {
    const p = glyphs.indexOf(key);
    if (p >= 0) return CANAANITE[p].id;
  }
  return null;
};

/** Map a typed key (any Semitic script, or Latin transliteration) to a letter id. */
export const letterFromKey = (key: string, alphabet: AlphabetId): string | null => {
  const letters = ALPHABETS[alphabet].letters;
  if (alphabet !== "arabic") {
    const native = canaaniteFromGlyph(key);
    if (native) return native;
    const fromArabic = ARABIC_TO_CANAANITE[ARABIC_VARIANTS[key] ?? key];
    if (fromArabic) return fromArabic;
    // Exact match first so that "S" (shin) and "s" (samekh) stay distinct.
    const exact = letters.find((l) => l.keys?.includes(key));
    if (exact) return exact.id;
    return letters.find((l) => l.keys?.includes(key.toLowerCase()))?.id ?? null;
  }
  const k = ARABIC_VARIANTS[key] ?? key;
  if (letters.some((l) => l.id === k)) return k;
  const c = canaaniteFromGlyph(key);
  return c ? CANAANITE_TO_ARABIC[c] : null;
};

// ------------------------------------------------------------------- game

export type Player = { name: string; color: string };

export type Move = {
  tri: string;
  /** The root as named, first radical first. */
  root: string[];
  /** The letter placed on each corner, in triVerts order. */
  corners: string[];
  gloss: string;
  /** Which language the player drew the root from, if they said. */
  lang?: string;
  player: number;
};

export const LANGUAGES = [
  "Hebrew", "Aramaic", "Syriac", "Arabic", "Akkadian", "Ugaritic", "Phoenician",
  "Ge'ez", "Amharic", "Tigrinya", "Tigre", "Old South Arabian", "Mehri", "Soqotri", "Maltese",
  "Other Semitic",
];

export type Game = {
  version: 1;
  alphabet: AlphabetId;
  script: ScriptId;
  players: Player[];
  moves: Move[];
  /** Whose turn it is. Passing moves the pen on without leaving a record. */
  turn: number;
};

export const PLAYER_COLORS = ["#b5532f", "#3d5a80", "#6b7d2a", "#8a4f7d"];

export const newGame = (alphabet: AlphabetId, names: string[]): Game => ({
  version: 1,
  alphabet,
  script: ALPHABETS[alphabet].scripts[0],
  players: names.map((name, i) => ({ name, color: PLAYER_COLORS[i % PLAYER_COLORS.length] })),
  moves: [],
  turn: 0,
});

export type Board = {
  /** Letter at each lettered vertex. */
  letters: Map<string, string>;
  /** Claimed triangles and the move index that claimed them. */
  claimed: Map<string, number>;
  /** Roots already played, as joined strings. */
  used: Set<string>;
  /** Unclaimed triangles that touch at least one lettered vertex. */
  open: Set<string>;
};

export const boardOf = (game: Game): Board => {
  const letters = new Map<string, string>();
  const claimed = new Map<string, number>();
  const used = new Set<string>();
  game.moves.forEach((m, i) => {
    claimed.set(m.tri, i);
    used.add(m.root.join(""));
    triVerts(parseTri(m.tri)).forEach((v, j) => letters.set(vKey(v), m.corners[j]));
  });
  const open = new Set<string>();
  for (const m of game.moves) {
    for (const v of triVerts(parseTri(m.tri))) {
      for (const t of trisAround(v)) {
        const k = tKey(t);
        if (!claimed.has(k)) open.add(k);
      }
    }
  }
  return { letters, claimed, used, open };
};

/** Letters already fixed on a triangle's corners (null where blank). */
export const fixedCorners = (board: Board, tri: Tri) =>
  triVerts(tri).map((v) => board.letters.get(vKey(v)) ?? null);

const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/**
 * Every way to lay a root's letters onto a triangle's corners that agrees
 * with the letters already there. Each result lists the letter per corner.
 */
export const arrangements = (fixed: (string | null)[], root: string[]): string[][] => {
  if (root.length !== 3) return [];
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const p of PERMS) {
    const corners = p.map((i) => root[i]);
    if (corners.every((l, j) => fixed[j] === null || fixed[j] === l)) {
      const k = corners.join("");
      if (!seen.has(k)) {
        seen.add(k);
        out.push(corners);
      }
    }
  }
  return out;
};

export type Verdict = { ok: boolean; reason?: string };

/** Can this triangle be played at all (before a root is named)? */
export const canPlayAt = (game: Game, board: Board, tri: Tri): Verdict => {
  const k = tKey(tri);
  if (board.claimed.has(k)) return { ok: false, reason: "That triangle already holds a root." };
  if (game.moves.length > 0 && !board.open.has(k))
    return { ok: false, reason: "A new triangle has to touch a letter already on the board." };
  return { ok: true };
};

export const checkRoot = (game: Game, board: Board, tri: Tri, root: string[]): Verdict => {
  const at = canPlayAt(game, board, tri);
  if (!at.ok) return at;
  if (root.length < 3) return { ok: false, reason: "Name all three radicals." };
  if (board.used.has(root.join(""))) return { ok: false, reason: "That root has already been played." };
  const fixed = fixedCorners(board, tri);
  if (arrangements(fixed, root).length === 0) {
    const need = fixed.filter(Boolean) as string[];
    return {
      ok: false,
      reason: `This triangle needs a root containing ${need.map((l) => glyph(l, game.script)).join(" + ")}.`,
    };
  }
  return { ok: true };
};

/** Scores: triangles claimed per player. */
export const scores = (game: Game) =>
  game.players.map((_, i) => game.moves.filter((m) => m.player === i).length);

// ------------------------------------------------------------ full points

/** Points for completing a star: all six triangles around one letter. */
export const STAR_BONUS = 2;

export type Star = { vertex: string; player: number; move: number };

/**
 * Letters whose six surrounding triangles are all filled. The player who
 * laid the sixth triangle completes the star and takes the bonus.
 */
export const starsOf = (game: Game): Star[] => {
  const claimed = new Map(game.moves.map((m, i) => [m.tri, i]));
  const seen = new Set<string>();
  const stars: Star[] = [];
  for (const m of game.moves) {
    for (const v of triVerts(parseTri(m.tri))) {
      const k = vKey(v);
      if (seen.has(k)) continue;
      seen.add(k);
      const idx = trisAround(v).map((t) => claimed.get(tKey(t)));
      if (idx.every((i) => i !== undefined)) {
        const last = Math.max(...(idx as number[]));
        stars.push({ vertex: k, player: game.moves[last].player, move: last });
      }
    }
  }
  return stars.sort((a, b) => a.move - b.move);
};

export type Score = { roots: number; stars: number; points: number };

export const scoreboard = (game: Game): Score[] => {
  const stars = starsOf(game);
  return game.players.map((_, i) => {
    const roots = game.moves.filter((m) => m.player === i).length;
    const st = stars.filter((s) => s.player === i).length;
    return { roots, stars: st, points: roots + STAR_BONUS * st };
  });
};

/** Stars completed by one particular move. */
export const starsMadeBy = (game: Game, moveIndex: number) =>
  starsOf(game).filter((s) => s.move === moveIndex);

// ------------------------------------------------------------------ moves

export type Action =
  | { type: "place"; tri: string; root: string[]; corners: string[]; gloss?: string; lang?: string }
  | { type: "pass" }
  | { type: "undo" };

/**
 * Apply one action for one player. Used by the board itself and, for games
 * played online, by the server, so both enforce the same rules.
 */
export const applyAction = (game: Game, player: number, action: Action): { game?: Game; error?: string } => {
  const n = game.players.length;
  if (player < 0 || player >= n) return { error: "No such seat." };
  if (action.type === "undo") {
    const last = game.moves[game.moves.length - 1];
    if (!last) return { error: "Nothing to undo." };
    if (last.player !== player) return { error: "Only the player who laid the last root can take it back." };
    return { game: { ...game, moves: game.moves.slice(0, -1), turn: last.player } };
  }
  if (game.turn % n !== player) return { error: `It's ${game.players[game.turn % n].name}'s turn.` };
  if (action.type === "pass") return { game: { ...game, turn: (game.turn + 1) % n } };
  if (action.type !== "place") return { error: "Unknown move." };
  const { tri, root, corners } = action;
  const ids = new Set(ALPHABETS[game.alphabet].letters.map((l) => l.id));
  if (!/^-?\d+,-?\d+,[01]$/.test(tri) || !Array.isArray(root) || !Array.isArray(corners)) return { error: "That move is malformed." };
  if (root.length !== 3 || corners.length !== 3 || ![...root, ...corners].every((l) => ids.has(l)))
    return { error: "A root is three letters of this game's alphabet." };
  const board = boardOf(game);
  const t = parseTri(tri);
  const v = checkRoot(game, board, t, root);
  if (!v.ok) return { error: v.reason };
  const fits = arrangements(fixedCorners(board, t), root).some((a) => a.join("") === corners.join(""));
  if (!fits) return { error: "Those letters don't sit on the corners that way." };
  const gloss = typeof action.gloss === "string" ? action.gloss.slice(0, 120) : "";
  const lang = typeof action.lang === "string" ? action.lang.slice(0, 40) : "";
  return {
    game: {
      ...game,
      moves: [...game.moves, { tri, root, corners, gloss, ...(lang ? { lang } : {}), player }],
      turn: (player + 1) % n,
    },
  };
};

// ------------------------------------------------------------ persistence

const isGame = (g: unknown): g is Game => {
  const x = g as Game;
  return (
    !!x && x.version === 1 && (x.alphabet === "canaanite" || x.alphabet === "syriac" || x.alphabet === "arabic") &&
    Array.isArray(x.players) && x.players.length > 0 && Array.isArray(x.moves) &&
    x.moves.every((m) => typeof m.tri === "string" && Array.isArray(m.root) && Array.isArray(m.corners)) &&
    typeof x.turn === "number"
  );
};

/** Older saves drew Syriac on the shared Hebrew board; give it its own. */
const normalize = (g: Game): Game =>
  g.alphabet === "canaanite" && g.script === "syriac" ? { ...g, alphabet: "syriac" } : g;

const toB64Url = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export const encodeGame = (game: Game) => toB64Url(JSON.stringify(game));

export const decodeGame = (s: string): Game | null => {
  try {
    const g = JSON.parse(fromB64Url(s));
    return isGame(g) ? normalize(g) : null;
  } catch {
    return null;
  }
};

export const parseStoredGame = (s: string | null): Game | null => {
  if (!s) return null;
  try {
    const g = JSON.parse(s);
    return isGame(g) ? normalize(g) : null;
  } catch {
    return null;
  }
};

// -------------------------------------------------------------- dictionary

/**
 * Roots from Brown-Driver-Briggs (Hebrew and Biblical Aramaic) and Lane's
 * Arabic-English Lexicon, keyed by their three letters: square Hebrew for
 * "he" and "arc", Arabic for "ar". Built by scripts/build_lexicon.py.
 */
export type Lexicon = { he: Record<string, string>; arc: Record<string, string>; ar: Record<string, string> };
export type RootSense = { lang: "Hebrew" | "Aramaic" | "Arabic"; gloss: string };
export type RootIndex = Map<string, RootSense[]>;

const add = (idx: RootIndex, key: string, sense: RootSense) => {
  const list = idx.get(key);
  if (!list) idx.set(key, [sense]);
  else if (list.length < 4 && !list.some((x) => x.lang === sense.lang)) list.push(sense);
};

/** Every dictionary root, spelled in the given alphabet's letters. */
export const buildRootIndex = (lex: Lexicon, alphabet: AlphabetId): RootIndex => {
  const idx: RootIndex = new Map();
  if (alphabet === "arabic") {
    for (const [k, gloss] of Object.entries(lex.ar)) add(idx, k, { lang: "Arabic", gloss });
    // Hebrew ש answers to both Arabic ش and س (šālôm, salām).
    const variants = (k: string): string[] => {
      let out = [""];
      for (const c of k) {
        const opts = c === "ש" ? ["ش", "س"] : [CANAANITE_TO_ARABIC[c]];
        out = out.flatMap((o) => opts.map((x) => o + x));
      }
      return out;
    };
    for (const [k, gloss] of Object.entries(lex.he)) for (const v of variants(k)) add(idx, v, { lang: "Hebrew", gloss });
    for (const [k, gloss] of Object.entries(lex.arc)) for (const v of variants(k)) add(idx, v, { lang: "Aramaic", gloss });
  } else {
    for (const [k, gloss] of Object.entries(lex.he)) add(idx, k, { lang: "Hebrew", gloss });
    for (const [k, gloss] of Object.entries(lex.arc)) add(idx, k, { lang: "Aramaic", gloss });
    for (const [k, gloss] of Object.entries(lex.ar)) {
      const c = [...k].map((x) => ARABIC_TO_CANAANITE[x]).join("");
      if (c.length === 3) add(idx, c, { lang: "Arabic", gloss });
    }
  }
  return idx;
};

/** What the dictionary knows about a root, and which other orders of its letters are roots too. */
export const lookupRoot = (idx: RootIndex, root: string[]) => {
  const senses = idx.get(root.join("")) ?? [];
  const seen = new Set([root.join("")]);
  const otherOrders: { root: string[]; senses: RootSense[] }[] = [];
  for (const p of PERMS) {
    const r = p.map((i) => root[i]);
    const k = r.join("");
    if (seen.has(k)) continue;
    seen.add(k);
    const s = idx.get(k);
    if (s) otherOrders.push({ root: r, senses: s });
  }
  return { senses, otherOrders };
};

/** Dictionary roots that would fit a triangle and haven't been played, best known first. */
export const hintsFor = (idx: RootIndex, fixed: (string | null)[], used: Set<string>, limit = 8) => {
  const out: { root: string[]; senses: RootSense[] }[] = [];
  for (const [k, senses] of idx) {
    if (used.has(k)) continue;
    const root = [...k];
    if (root.length !== 3) continue;
    if (arrangements(fixed, root).length) out.push({ root, senses });
  }
  out.sort((a, b) => b.senses.length - a.senses.length);
  return out.slice(0, limit);
};

// ---------------------------------------------------------- root explorer

/** [vocalized word, romanization, part of speech, meaning] */
export type Word = [string, string, string, string];
export type WordList = { words: Record<string, Word[]> };
export type RootFamily = { lang: "Hebrew" | "Arabic"; words: Word[] };

/** Words built on a root, from Wiktionary, for the game's alphabet. */
export const wordsFor = (he: WordList | null, ar: WordList | null, alphabet: AlphabetId, root: string[]): RootFamily[] => {
  const out: RootFamily[] = [];
  const key = root.join("");
  if (alphabet === "arabic") {
    const a = ar?.words[key];
    if (a) out.push({ lang: "Arabic", words: a });
    // Arabic letter -> Hebrew letter, reversing the table used for typing.
    const toHe = Object.fromEntries(Object.entries(CANAANITE_TO_ARABIC).map(([h, x]) => [x, h]));
    toHe["س"] = "ש";
    const hk = root.map((l) => toHe[l] ?? ARABIC_TO_CANAANITE[l]).join("");
    const h = he?.words[hk];
    if (h) out.push({ lang: "Hebrew", words: h });
  } else {
    const h = he?.words[key];
    if (h) out.push({ lang: "Hebrew", words: h });
    if (ar) {
      for (const [k, words] of Object.entries(ar.words)) {
        if ([...k].map((l) => ARABIC_TO_CANAANITE[l]).join("") === key) {
          out.push({ lang: "Arabic", words });
          break;
        }
      }
    }
  }
  return out;
};
