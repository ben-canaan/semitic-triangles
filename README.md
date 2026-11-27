# Semitic Triangles

A word game built on the three-letter Semitic root, from the essay
["Semitic triangles: the romance of the three-letter root"](https://whitmanic.substack.com/p/semitic-triangles-the-most-obscure)
by Josh Lipson.

The board is an endless lattice of triangles. Each triangle holds one root,
one radical per corner; a letter at a point is shared by the six triangles
that meet there. A new root must fit the letters already on its corners, and
no root may be played twice.

- Hebrew/Paleo-Hebrew (22 letters, switchable script) or Arabic (28 letters)
- 1-4 players on one device; trade moves remotely with a game link
- Installable as a phone/desktop app ("Add to Home Screen"), works offline

## Develop

    npm install
    npm run dev

## Deploy

Netlify: connect this repo; `netlify.toml` has the build settings.
Game logic lives in `src/lib/triangles.ts`; the interface in `src/App.tsx`.

## Root dictionary

`src/data/roots.json` is built by `scripts/build_lexicon.py` from Wiktionary
(via kaikki.org, CC BY-SA 4.0), Brown-Driver-Briggs (Open Scriptures Hebrew
Bible Project, CC BY 4.0) and Lane's Arabic-English Lexicon (Perseus Digital
Library); the script's docstring lists the downloads. `scripts/check_lexicon.py`
checks the result against a list of common Hebrew and Arabic roots. The
dictionary only advises: roots it doesn't know can still be played.
