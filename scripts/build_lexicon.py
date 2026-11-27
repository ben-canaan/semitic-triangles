"""Build the Semitic Triangles root list (src/data/roots.json).

Sources, in order of preference for each root:
  1. Wiktionary, via the kaikki.org extracts (CC BY-SA 4.0): Hebrew and
     Arabic entries tagged with the root they belong to, and Hebrew root pages.
  2. Brown-Driver-Briggs, digital edition by the Open Scriptures Hebrew Bible
     Project (CC BY 4.0): Hebrew and Biblical Aramaic roots.
  3. E. W. Lane, An Arabic-English Lexicon, digital edition by the Perseus
     Digital Library (free distribution with credit).

Usage:
  python3 scripts/build_lexicon.py \
      --kaikki-hebrew Hebrew.jsonl --kaikki-arabic Arabic.jsonl \
      --bdb BrownDriverBriggs.xml --lane lexicon_xml/ \
      --out src/data/roots.json

Downloads:
  https://kaikki.org/dictionary/Hebrew/kaikki.org-dictionary-Hebrew.jsonl
  https://kaikki.org/dictionary/Arabic/kaikki.org-dictionary-Arabic.jsonl
  https://raw.githubusercontent.com/openscriptures/HebrewLexicon/master/BrownDriverBriggs.xml
  https://github.com/quranic-research/lexicon_xml (Lane, TEI XML)

Output: {"he": {root: gloss}, "arc": {...}, "ar": {...}, "_source": [...]},
roots spelled as three letters in the game's letter ids (square Hebrew
without final forms or shin/sin dots; Arabic with hamza seats folded to ء).
"""
import argparse, glob, html, json, re, unicodedata

ap = argparse.ArgumentParser()
ap.add_argument("--kaikki-hebrew")
ap.add_argument("--kaikki-arabic")
ap.add_argument("--kaikki-geez", help="kaikki.org Ge'ez extract (https://kaikki.org/dictionary/Ge%27ez/)")
ap.add_argument("--bdb")
ap.add_argument("--lane")
ap.add_argument("--out", required=True)
ap.add_argument("--words-dir", help="also write words-he.json and words-ar.json (the root explorer) here")
args = ap.parse_args()

# ----------------------------------------------------------------- letters
FINALS = {"ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ"}
HEB = set("אבגדהוזחטיכלמנסעפצקרשת")
AR_FOLD = {"ا": "ء", "أ": "ء", "إ": "ء", "آ": "ء", "ؤ": "ء", "ئ": "ء", "ى": "ي", "ة": "ت"}
AR = set("ءبتثجحخدذرزسشصضطظعغفقكلمنهوي")


def heb_root(s):
    """'שׁ־ב־ע' or 'שָׁבַע' -> 'שבע' (only the 22 base letters)."""
    s = unicodedata.normalize("NFD", s)
    return "".join(FINALS.get(c, c) for c in s if FINALS.get(c, c) in HEB)


GEEZ_ORDER = "ሀለሐመሠረሰቀበተኀነአከወዐዘየደገጠጰጸፀፈፐ"
GEEZ_EXTRA = {"ሸ": "ሰ", "ቸ": "ተ", "ኘ": "ነ", "ዠ": "ዘ", "ጀ": "ደ", "ጨ": "ጠ", "ኸ": "ከ", "ቨ": "በ", "ዸ": "ደ", "ጘ": "ገ"}
GEEZ_LABIAL = [(0x1248, 0x125F, "ቀ"), (0x1288, 0x128F, "ኀ"), (0x12B0, 0x12BF, "ከ"), (0x1310, 0x131F, "ገ")]


def geez_root(s):
    """Any Ethiopic spelling -> its consonants in first-order form (ክ-ት-ብ -> ከተበ)."""
    out = ""
    for ch in s:
        cp = ord(ch)
        if not 0x1200 <= cp <= 0x137F:
            continue
        base = next((b for lo, hi, b in GEEZ_LABIAL if lo <= cp <= hi), None)
        if base is None:
            first = chr(cp - (cp - 0x1200) % 8)
            base = GEEZ_EXTRA.get(first, first)
        if base in GEEZ_ORDER:
            out += base
    return out


def ar_root(s):
    s = unicodedata.normalize("NFC", s)
    return "".join(AR_FOLD.get(c, c) for c in s if AR_FOLD.get(c, c) in AR)


# ---------------------------------------------------------------- glosses
SKIP_GLOSS = re.compile(
    r"^(defective|alternative|obsolete|archaic|plene|misspelling|nonstandard|verbal noun|"
    r"inflection|form of|construct|plural of|feminine of|masculine of|passive participle|"
    r"active participle|abbreviation|initialism|synonym|apocopated|clipping)",
    re.I,
)
# Inflected forms that slip through untagged: "will say: third-person ... of X".
INFLECTED = re.compile(r"\b(person|singular|plural|infinitive|imperative|future|past|participle)\b.* of ", re.I)


def tidy(g, maxlen=70):
    """Shorten a Wiktionary gloss: no parentheticals, at most a few comma parts."""
    g = re.sub(r"\s*\([^()]*\)", "", g)
    g = re.sub(r"\s*\[[^\]]*\]", "", g)
    g = re.sub(r"\s+", " ", g).strip(" .;:,")
    parts = [p.strip() for p in re.split(r";", g)[0].split(",") if p.strip()]
    out = ""
    for p in parts:
        nxt = p if not out else out + ", " + p
        if len(nxt) > maxlen:
            break
        out = nxt
    return out or g[:maxlen].rsplit(" ", 1)[0]


def first_gloss(entry):
    for s in entry.get("senses", []):
        if "form-of" in s.get("tags", []) or "alt-of" in s.get("tags", []):
            continue
        for g in s.get("glosses", []) or []:
            if g and not SKIP_GLOSS.match(g) and not INFLECTED.search(g):
                g = tidy(g)
                return g[0].lower() + g[1:] if g[:3] == "To " else g
    return None


def categories(entry):
    out = []
    for s in entry.get("senses", []):
        for c in s.get("categories", []):
            out.append(c["name"] if isinstance(c, dict) else c)
    for c in entry.get("categories", []):
        out.append(c["name"] if isinstance(c, dict) else c)
    return out


def head_arg(entry, template, key="1"):
    for t in entry.get("head_templates", []):
        if t.get("name") == template:
            return (t.get("args") or {}).get(key, "")
    return ""


# Prefer the simplest verb stem: Hebrew pa'al, Arabic form I.
HE_STEM_RANK = {"pa": 0, "pi": 1, "hi": 2, "ni": 3, "hit": 4, "pu": 5, "ho": 6}
POS_RANK = {"verb": 0, "noun": 1, "adj": 2}


def candidate_rank(entry, lang, root):
    """Lower is better: verbs first, the bare root itself (כתב, كتب) first among verbs, then the simplest stem."""
    pos = POS_RANK.get(entry.get("pos"), 3)
    bare = 0 if TO_ROOT[lang](entry.get("word", "")) == root else 1
    return (pos, bare) + _stem_rank(entry, lang, pos)


def _stem_rank(entry, lang, pos):
    if entry.get("pos") != "verb":
        return (9,)
    if lang == "he":
        return (HE_STEM_RANK.get(head_arg(entry, "he-verb").split("-")[0], 7),)
    a = head_arg(entry, "ar-verb")
    return (0 if re.match(r"^I($|[/.])", a) else 1,)


PREFIX = {"he": "Hebrew terms belonging to the root ", "ar": "Arabic terms belonging to the root ",
          "gez": "Ge'ez terms belonging to the root "}
TO_ROOT = {"he": heb_root, "ar": ar_root, "gez": geez_root}


def wiktionary(path, lang):
    """root -> gloss from one kaikki.org language extract."""
    prefix, to_root = PREFIX[lang], TO_ROOT[lang]
    root_pages, best = {}, {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            if lang == "he" and e.get("pos") == "root":
                r = heb_root(e["word"])
                g = next((g for s in e.get("senses", []) for g in (s.get("glosses") or [])), None)
                if len(r) == 3 and g:
                    m = re.match(r"^Forming words (?:pertaining|relating|related|having to do) (?:to|with) (.+?)\.?$", g)
                    page = "related to " + tidy(m.group(1), 50) if m else tidy(g)
                    root_pages.setdefault(r, page[0].lower() + page[1:])
                continue
            roots = {to_root(c[len(prefix):]) for c in categories(e) if c.startswith(prefix)}
            if lang == "ar":
                for t in e.get("etymology_templates", []):
                    if t.get("name") in ("ar-rootbox", "ar-root"):
                        roots.add(ar_root((t.get("args") or {}).get("1", "")))
            # A three-letter verb with no root tag is its own root (כתב, كتب).
            bare = to_root(e.get("word", ""))
            if not roots and e.get("pos") == "verb" and len(bare) == 3:
                roots.add(bare)
            roots = {r for r in roots if len(r) == 3}
            if not roots:
                continue
            g = first_gloss(e)
            if not g:
                continue
            for r in roots:
                rank = candidate_rank(e, lang, r)
                if r not in best or rank < best[r][0]:
                    best[r] = (rank, g)
    out = {}
    for r in set(root_pages) | set(best):
        verb = best.get(r, (None, None))[1]
        page = root_pages.get(r)
        # A root page names the field; the verb gives the core sense.
        if page and verb and verb.lower() not in page.lower():
            out[r] = f"{verb} ({page})" if len(verb) + len(page) < 80 else verb
        elif page and verb is None:
            out[r] = page
        else:
            out[r] = verb or page
    return out


def form(entry, tag):
    for f in entry.get("forms", []):
        if tag in (f.get("tags") or []):
            return f.get("form")
    return None


def wiktionary_words(path, lang, per_root=10):
    """root -> [[vocalized word, romanization, part of speech, gloss], ...] for the root explorer."""
    prefix = "Hebrew terms belonging to the root " if lang == "he" else "Arabic terms belonging to the root "
    to_root = heb_root if lang == "he" else ar_root
    found = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            pos = e.get("pos")
            if pos not in ("verb", "noun", "adj", "adv"):
                continue
            roots = {to_root(c[len(prefix):]) for c in categories(e) if c.startswith(prefix)}
            if lang == "ar":
                for t in e.get("etymology_templates", []):
                    if t.get("name") in ("ar-rootbox", "ar-root"):
                        roots.add(ar_root((t.get("args") or {}).get("1", "")))
            bare = to_root(e.get("word", ""))
            if not roots and pos == "verb" and len(bare) == 3:
                roots.add(bare)
            roots = {r for r in roots if len(r) == 3}
            if not roots:
                continue
            g = first_gloss(e)
            if not g:
                continue
            word = form(e, "canonical") or e["word"]
            rom = form(e, "romanization") or ""
            for r in roots:
                lst = found.setdefault(r, [])
                if len(lst) < 40 and not any(w[0] == word for w in lst):
                    lst.append([word, rom, pos, tidy(g, 60), candidate_rank(e, lang, r)])
    out = {}
    for r, lst in found.items():
        lst.sort(key=lambda w: w[4])
        # A mix: the root's main verbs, then the nouns and adjectives built on it.
        verbs = [w for w in lst if w[2] == "verb"][:4]
        others = [w for w in lst if w[2] != "verb"]
        pick = verbs + others[: per_root - len(verbs)]
        pick += [w for w in lst if w not in pick][: per_root - len(pick)]
        out[r] = [w[:4] for w in pick]
    return out


# ---------------------------------------------------------- BDB and Lane
def clean(t):
    t = re.sub(r"<[^>]+>", "", t)
    return html.unescape(re.sub(r"\s+", " ", t)).strip(" ,;:.()[]")


STOP = {"thus", "them", "this", "that", "they", "there", "then", "when", "with", "unto", "upon", "from", "also"}


def join_glosses(gs, limit=3, maxlen=70):
    seen, outl = set(), []
    for g in gs:
        k = g.lower()
        if g and k not in seen and len(g) <= 40:
            seen.add(k)
            outl.append(g)
        if len(outl) == limit:
            break
    s = "; ".join(outl)
    return s if len(s) <= maxlen else s[:maxlen].rsplit(";", 1)[0]


def bdb(path):
    he, arc = {}, {}
    text = open(path, encoding="utf-8").read()
    lang = "he"
    for chunk in re.split(r"(<part [^>]*>)", text):
        m = re.match(r'<part [^>]*xml:lang="(\w+)"', chunk)
        if m:
            lang = "arc" if m.group(1) == "arc" else "he"
            continue
        # Root and verb entries alike: a root's own heading is often marked
        # only as an entry for its verb.
        for body in re.findall(r"<entry [^>]*>(.*?)</entry>", chunk, re.S):
            if "<pos>vb</pos>" not in body and 'type="root"' not in body:
                continue
            w = re.search(r"<w[^>]*>(.*?)</w>", body)
            if not w:
                continue
            root = heb_root(clean(w.group(1)))
            if len(root) != 3:
                continue
            defs = [clean(d) for d in re.findall(r"<def>(.*?)</def>", body, re.S)]
            defs = [d for d in defs if len(d) > 3 and d.lower() not in STOP
                    and not d.lower().startswith(("let ", "our ", "their ", "his ", "my "))]
            g = join_glosses(defs)
            target = arc if lang == "arc" else he
            if g and root not in target:
                target[root] = g
    return he, arc


LANE = {
    "A": "ء", "O": "ء", "b": "ب", "t": "ت", "v": "ث", "j": "ج", "H": "ح", "x": "خ",
    "d": "د", "c": "ذ", "r": "ر", "z": "ز", "s": "س", "X": "ش", "S": "ص", "D": "ض",
    "T": "ط", "Z": "ظ", "E": "ع", "g": "غ", "f": "ف", "q": "ق", "k": "ك", "l": "ل",
    "m": "م", "n": "ن", "h": "ه", "w": "و", "y": "ي", "I": "ي",
}


def lane_gloss(body):
    """Lane's first definitions: from each italic phrase to the end of its clause."""
    senses = []
    for m in re.finditer(r"<hi>", body):
        rest = body[m.start():m.start() + 1500]
        rest = re.sub(r"<foreign[^>]*>.*?</foreign>|<anchor[^>]*>.*?</anchor>|<pb[^>]*/>", " ", rest, flags=re.S)
        text = re.split(r"[:;(\[]| \(| \[", clean(rest))[0]
        text = re.sub(r"\s+", " ", text).strip(" ,.")
        text = re.sub(r"^(i\. e\.|i\. q\.?|or|and) ", "", text)
        if text.lower().startswith(("i.", "i ")):
            continue
        if senses and set(re.findall(r"\w+", text.lower())) <= set(re.findall(r"\w+", senses[0].lower())):
            continue
        if len(text) >= 3 and not re.match(r"^(i\. ?[eq]|[A-Z][a-z]+ [a-z]+$)", text):
            senses.append(text[0].lower() + text[1:] if not text.startswith("I ") else text)
        if len(senses) == 2:
            break
    return join_glosses(senses, limit=2, maxlen=80)


def lane(directory):
    ar = {}
    for f in sorted(glob.glob(directory + "/*.xml")):
        s = open(f, encoding="utf-8").read()
        for rid, body in re.findall(r'<superEntry type="main" xml:id="Root_([^"]+)">(.*?)</superEntry>', s, re.S):
            if any(c not in LANE for c in rid):
                continue
            letters = [LANE[c] for c in rid]
            if len(letters) == 2:  # Lane files doubled roots under two letters: مدّ = m-d-d
                letters.append(letters[1])
            if len(letters) != 3:
                continue
            g = lane_gloss(body)
            if g:
                ar.setdefault("".join(letters), g)
    return ar


# ------------------------------------------------------------------ merge
he, arc, ar = {}, {}, {}
counts = {}
if args.kaikki_hebrew:
    w = wiktionary(args.kaikki_hebrew, "he")
    counts["he (Wiktionary)"] = len(w)
    he.update(w)
if args.kaikki_arabic:
    w = wiktionary(args.kaikki_arabic, "ar")
    counts["ar (Wiktionary)"] = len(w)
    ar.update(w)
gez = {}
if args.kaikki_geez:
    gez = wiktionary(args.kaikki_geez, "gez")
    counts["gez (Wiktionary)"] = len(gez)
if args.bdb:
    bh, ba = bdb(args.bdb)
    counts["he (BDB, added)"] = sum(1 for r in bh if r not in he)
    for r, g in bh.items():
        he.setdefault(r, g)
    arc.update(ba)
if args.lane:
    la = lane(args.lane)
    counts["ar (Lane, added)"] = sum(1 for r in la if r not in ar)
    for r, g in la.items():
        ar.setdefault(r, g)

data = {
    "_source": [
        "Hebrew, Arabic and Ge'ez: Wiktionary (https://en.wiktionary.org), via kaikki.org, CC BY-SA 4.0.",
        "Hebrew and Aramaic: Brown-Driver-Briggs, digital edition by the Open Scriptures Hebrew Bible Project, CC BY 4.0 (https://github.com/openscriptures/HebrewLexicon).",
        "Arabic: E. W. Lane, An Arabic-English Lexicon. Text provided by Perseus Digital Library, with funding from The U.S. Department of Education and The Max Planck Society. This text may be freely distributed, subject to the following restrictions: You credit Perseus, as follows, whenever you use the document: Text provided by Perseus Digital Library, with funding from The U.S. Department of Education and The Max Planck Society. You leave this availability statement intact. You offer Perseus any modifications you make.",
        "Glosses are shortened extracts; roots are given as three consonants.",
    ],
    "he": dict(sorted(he.items())),
    "arc": dict(sorted(arc.items())),
    "ar": dict(sorted(ar.items())),
    "gez": dict(sorted(gez.items())),
}
if args.words_dir:
    for lang, path in (("he", args.kaikki_hebrew), ("ar", args.kaikki_arabic)):
        if path:
            words = wiktionary_words(path, lang)
            with open(f"{args.words_dir}/words-{lang}.json", "w", encoding="utf-8") as f:
                json.dump({"_source": "Wiktionary (https://en.wiktionary.org), via kaikki.org, CC BY-SA 4.0.",
                           "words": dict(sorted(words.items()))}, f, ensure_ascii=False, separators=(",", ":"))
            counts[f"words-{lang}"] = len(words)

with open(args.out, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
print(counts, {k: len(v) for k, v in data.items() if k != "_source"})
