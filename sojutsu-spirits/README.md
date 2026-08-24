# SOJUTSU-SPIRITS

A portrait, one-thumb, mobile spirit-binding RPG set in a rain-worn South-East-Asian
dark-fantasy world. You are a **Sojutsuka** — a spear-binder licensed by the Bureau — walking
with a bound **Cursed Spirit** and settling what the world has stopped counting.

**Arithmetic is the weapon.** A spirit will not strike until its binder resolves the number.
Hold a run of correct answers and the **Chain** compounds your damage; miss one and the chain
drops — but you still take your turn.

> "A drop isn't a fail. It's a turn." — Jessica
> "You don't stop dropping. You drop later." — Ay

That is the whole difficulty curve, and it is why failure here never costs progress, only
multiplier.

---

## Running it

```bash
npm install
npm run ingest     # reference data -> validated game data   (already committed)
npm run assets     # source art -> texture atlases           (already committed)
npm run dev        # http://127.0.0.1:5173
```

Open it in a phone-shaped viewport — the game is portrait-only by design.

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | typecheck, then a production build into `dist/` |
| `npm run verify` | typecheck + lint + the full unit suite |
| `npm test` | unit tests only |
| `npm run smoke` | drives the built game in Chromium and screenshots every mode |
| `npm run ingest` | rebuilds `src/data/generated` from `reference/data` |
| `npm run assets` | rebuilds `assets/generated` from `assets/source` and `reference` |
| `npm run assets:generate` | fills gaps in `assets/source/generated` via the PixelLab API |

`assets:generate` needs `PIXELLAB_API_KEY` in a gitignored `.env.local`. Every other script
works offline; `npm run assets` falls back to procedural art for anything missing so a build
never blocks on a network call.

---

## How it fits together

```
reference/            the canonical bundle, vendored: manga, data, visual refs, research
  ↓  npm run ingest
src/data/generated/   96 species · 104 moves · 9 encounter zones · the aspect chart

src/core/             the rules. Pure TypeScript, zero Phaser, seeded, 100% unit-tested.
src/math/             the Chain. Curriculum, question generation, timing. Also pure.
src/game/             Phaser: scenes, world generation, actors, camera, state, story
src/ui/               the control deck, HUD, keypad — drawn, not textured
tools/                ingest · asset pipeline · browser verification
```

`src/core` and `src/math` never import Phaser, and a unit test enforces it. The battle engine is
therefore seedable, replayable and portable, and a rendering bug can never be a damage bug.

**Read [`docs/DESIGN.md`](docs/DESIGN.md) first.** It carries the attachment audit, the engine
decision, and the screen architecture. [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) lists every
decision made in the master prompt's absence and where to change each one.
[`docs/BALANCE.md`](docs/BALANCE.md) carries the simulated shrine difficulty and one finding the
founder needs to rule on.

---

## The screen

All three supplied mode references are the same portrait frame and differ only in the bottom
third. That is the central UI fact of this game: **the world never goes away, and the deck is
the mode indicator.**

```
┌──────────────────────────┐
│      WORLD VIEWPORT      │   the same camera in all three modes
│   (never cuts to battle) │   combat pushes in; it does not cut away
├──────────────────────────┤ ← 62%
│      CONTROL DECK        │   morphs per mode
└──────────────────────────┘
```

| Mode | Deck |
|---|---|
| **Exploration** | analogue stick, dash, spear, backpack |
| **Math combat** | equation strip + `BACK`, 3 × 4 numeric keypad |
| **Finish** | the exploration deck returns — the spear button *is* the Finish |

---

## Combat in one turn

1. Pick a move from the bound spirit's four slots.
2. Its `mathTier` picks a question band; its `radModifier` scales the answer timer.
3. The question appears. The bar drains.
4. **Correct** → the chain grows and the move lands at full power.
   **Dropped** → the chain resets and the move lands short or fizzles.
5. Damage resolves through the Gen-1-lineage formula, then × the chain multiplier.
6. **The enemy acts either way.** A drop costs the multiplier, never the turn.

When a wild spirit faints the fight does not end: the deck reverts and the spear button opens
the **Finish** — tap to Sever, hold to Bind.

---

## What is implemented

- The complete battle system of `sojutsu-battle-math.md`: stats, Grade and Resonance, the damage
  formula with its nested floors, the modern 18-aspect chart with both required corrections,
  stage-based crits, the separate accuracy and stat-stage tables, statuses including the 20%
  thaw, turn order, party switching, the four-roll capture, growth curves, evolution, money and
  obedience.
- The Chain, with the curriculum drawn from the manga's own mathematics across three bands
  gated by sigils.
- 15 zones across the three Part-One regions, wired to the approved encounter tables; waystone
  puzzles, shops, the Mendery, and the three shrines with their documented aces.
- Dialogue from the manga, save/load, the Monsterdex, party, bag, and a report card that tells
  the player which arithmetic is actually costing them chains.
- 268 unit tests, plus a browser harness that drives the production build on a phone viewport
  and screenshots every mode.

## What is not

- **Part 2.** The eleven-zone segment 4–6 skeleton and the 24 Final B forms are ingested and
  validated but not shipped, exactly as `sojutsu-battle-math.md` §11 instructs.
- **Audio.** No brief, no assets, and nothing in the references to match it against.
- **Hand-authored hero plates.** Zone terrain is generated behind the interface the research
  bundle specifies, so authored plates can replace it without touching a scene. See
  [A-9].
