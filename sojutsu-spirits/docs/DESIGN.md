# SOJUTSU-SPIRITS — Architecture & Design Authority

> **Status:** greenfield build, Phase One.
> **Authorities, in order:** the master prompt → the manga (`reference/story`) → the three
> gameplay-mode references (`reference/visual`) → `reference/data` → `reference/research`.

---

## 0. Attachment audit

Performed before any architecture decision, as the handoff requires.

| Logical name | Path | Verdict |
|---|---|---|
| `STORY_PDF` | `reference/story/sojutsu-spirits-phase-one-current.pdf` | **Present.** 54 pages, image-only (no text layer). Read page-by-page at 2× raster. Phase One ends with "The road stays open." |
| `MONSTERDEX_BUNDLE` | `reference/monsterdex/` | **Present.** 96 dex PNGs + catalogue HTML. 24 lines × 4 forms. |
| `SOJUTSU_DATA_BUNDLE` | `reference/data/` | **Present and complete.** Battle math, aspect chart, catch rates, encounters, unified moves (104), 5 CSVs. |
| `PLAYER_ASSETS` | `reference/characters/Manga_Sojutsuka_Player.zip` | **Present.** 48×48, 8 rotations, 4-frame walk N/S/E. PixelLab export v3.1. |
| `FAWNIX_ASSETS` | `reference/characters/Manga_Fawnix.zip` | **Present.** 32×32, 8 rotations, 5-frame walk N/S/E. |
| `GEARBIT_ASSET` | `reference/monsterdex/dex/005-gearbit.png` | **Present, but a placeholder** — 64×64, five colours, 273 bytes, where 72 of the 96 are 512×512 full art. One of 24. See §7.1. |
| `EXPLORATION_MODE_REFERENCE` | `reference/visual/exploration-mode-reference.png` | **Present.** 853×1844 portrait. Binding. |
| `MATH_COMBAT_REFERENCE` | `reference/visual/math-combat-reference.png` | **Present.** 852×1846 portrait. Binding. |
| `FINISH_MODE_REFERENCE` | `reference/visual/finish-mode-reference.png` | **Present.** 853×1844 portrait. Binding. |
| `EASTWARD_REFERENCE_A/B` | `reference/visual/eastward-reference-*.jp*g` | Present. Supporting. |
| `EASTWARD_RESEARCH_BUNDLE` | `reference/research/` | Present. Two documents. Both recommend Phaser 3. |
| **`MASTER_PROMPT`** | — | **ABSENT.** See §0.1. |

### 0.1 The master prompt was not supplied

`README_FIRST.md` step 2 says the master prompt is "intentionally not duplicated inside this
size-limited reference archive" and must be pasted into the same task. It was not. The handoff
README was supplied in its place.

The master prompt is named as "the current product authority", so its absence is the single
largest risk in this build. Everything below is reconstructed from the artefacts that *were*
supplied. Where the master prompt would plainly have decided something, this document records
an explicit assumption tagged **[A-n]** and implements it behind a single, swappable constant so
a founder correction is a data edit, not a rewrite. Assumptions are collected in
[`ASSUMPTIONS.md`](./ASSUMPTIONS.md).

---

## 1. What the game is

A portrait, one-thumb, mobile spirit-binding RPG set in a rain-worn South-East-Asian
dark-fantasy world. The player is a **Sojutsuka** — a spear-binder licensed by the Bureau —
who walks with a bound **Cursed Spirit** and settles what the world has stopped counting.

The hook, and the reason the game exists: **arithmetic is the weapon.** A spirit will not
strike until its binder resolves the number. Hold a run of correct answers and the **Chain**
compounds your damage; miss one and the chain drops — but you still take your turn. The manga
states the design pillar outright:

> "A drop isn't a fail, it's a turn." — Jessica
> "You don't stop dropping. You drop later." — Ay

That is the whole difficulty curve, and it is why failure in this game is never punished with a
loss of progress, only with a loss of *multiplier*.

---

## 2. Engine and stack

**Phaser 3.90 + TypeScript (strict) + Vite.** Vitest for the engine. No runtime dependency
beyond Phaser.

Both research documents land on Phaser independently, and their reasoning holds:

- The target look is a *baked* Eastward-style hero plate with authored gameplay layers, not
  real 3D. The projection is painted into the art, so an orthographic 2D camera is correct.
- Everything the mode references demand — feet-biased collision, feet-Y depth sort, an overhead
  occlusion layer, localized animated water, additive glows, normal-mapped Light2D — is stock
  Phaser 3.90.
- A 3D engine would buy volumetrics and global illumination that this art style deliberately
  does not use, at the cost of an art pipeline nobody in this handoff can feed.

The limiting factor on this project is art production, not engine capability. Choosing the
engine that makes art cheap is the correct trade.

### 2.1 Layering

```
src/core/     pure TypeScript. Zero Phaser imports. Deterministic. 100% unit-tested.
src/math/     the Chain/Cadence layer: curriculum, question generation, timing. Also pure.
src/data/     generated, validated game data (from tools/ingest).
src/game/     Phaser: scenes, actors, camera, input, rendering.
src/ui/       the control deck, HUD, keypad, dialogue — DOM-free, drawn in Phaser.
tools/        ingest, asset pipeline, verification harness. Node-side only.
```

`src/core` and `src/math` never import Phaser, and `src/core` does not import `src/math`
either — the rules must not depend on the arithmetic. All three constraints are enforced by
`src/math/purity.test.ts`, which scans both layers for forbidden imports, `Math.random` and any
read of the clock, so the rule cannot rot. That is what keeps the battle engine testable,
seedable and portable, and what makes it impossible for a rendering bug to be a damage bug.

---

## 3. Screen architecture (binding, from the three references)

All three references are the same 853×1844 portrait frame, and they differ only in what the
lower third contains. That is the central UI insight of this game and it drives the whole
layout: **the world never goes away, and the deck is the mode indicator.**

```
┌──────────────────────────┐  ← 0 %
│                          │
│      WORLD VIEWPORT      │   the same camera in all three modes
│      (Eastward plate)    │   battle pushes in, it does not cut away
│                          │
├──────────────────────────┤  ← ~62 %
│      CONTROL DECK        │   morphs per mode
└──────────────────────────┘  ← 100 %
```

Logical resolution **540 × 1170** (9:19.5), `Phaser.Scale.FIT`, `pixelArt: true`,
`roundPixels: true`. Deck occupies the bottom 38%. Safe-area insets respected.

| Mode | Deck contents (from the reference) |
|---|---|
| **Exploration** | analogue joystick (left), dash `»` (centre), action/spear (right), backpack (top-right of world) |
| **Math combat** | equation strip + `BACK`, 3×4 numeric keypad (`1-9`, `⌫`, `0`, `OK`) |
| **Finish** | reverts to the exploration deck — the spear action button is the Finish input |

The battle HUD (math-combat reference) sits *inside* the world viewport, not the deck: ally
portrait panel top-left, enemy top-right, each with name, `HP cur/max`, a green HP bar and a
blue **Chain** bar underneath.

---

## 4. Combat: reconciling Gen-1 math with the Chain

`sojutsu-battle-math.md` specifies a complete Gen-1-lineage battle system. The manga specifies a
real-time arithmetic chain. These are not in conflict — the arithmetic sits *in front of* the
damage formula as an input to it. One turn resolves as:

```
1.  Player picks a move from the bound spirit's four slots.
2.  The move's engine.mathTier selects a question band; engine.radModifier scales the timer.
3.  A question is posed on the equation strip. The timer bar drains.
4a. Correct in time  → chain += 1 × engine.crgModifier   → move resolves at full power
4b. Wrong / timeout  → chain drops to 0                  → engine.failureMode applies:
                                                            reduced_power → power × 0.5
                                                            move_fails    → the move fizzles
5.  Damage = the §2 formula from sojutsu-battle-math.md, then × chainMultiplier.
6.  The enemy acts. Statuses tick. Nothing about 4b skips the player's turn.
```

Step 6 is the pillar. A drop costs the multiplier, never the turn.

### 4.1 The Chain multiplier (Cadence) — **[A-1]**

The manga shows four multiplier readings and one explicit break point:

| Page | Reading |
|---|---|
| p17 | `×1.2` on a short chain |
| p18 | "Your chain held past six" — a threshold |
| p31–32 | "Your chain broke at seven. Every time. Same place." |
| p44 | "I drop them at nine now instead of three." |
| p48 | a 12-link chain reaching "TEN" at `×2` |

A single continuous curve fits all of them:

```
chainMultiplier = 1 + 0.10 × min(chain, 20)      →  chain 2 = ×1.2 ·  10 = ×2.0 ·  20 = ×3.0
```

Ten is the mid-game landmark the manga treats as hard-won, twenty is the mastery ceiling, and
`×3` (p04, spoken by a two-year veteran) is reachable but far. Implemented as
`CHAIN_CURVE` in `src/math/chain.ts`.

### 4.2 `crgModifier` and `radModifier` — **[A-2]**

The unified move catalogue ships an `engine` block on all 104 moves whose two named modifiers
are defined nowhere in the bundle. Their distributions are unambiguous about *shape*:

- `radModifier` is `0` on exactly two moves — **Detonate** and **Cataclysm Burst**, the only two
  moves whose effect is "User faints"; `1.2` on all six multi-turn charge moves; `0.8` on cheap
  utility and the one priority move.
- `crgModifier` is `1.35` on exactly the six multi-turn charge moves and `0.8` on cheap utility.

Read as:

- **RAD — Response Allowance Duration.** A multiplier on the answer timer. `1.2` on charge moves
  (the question is posed during the charge turn, so you get longer); `0.8` on fast/cheap moves
  (a quick move demands a quick answer); **`0` means no question is posed at all** — you do not
  need to do arithmetic to blow yourself up. The move auto-resolves and grants no chain.
- **CRG — Chain Rate Gain.** A multiplier on chain gained per correct solve. `1.35` rewards the
  two-turn commitment of a charge move; `0.8` prices cheap utility.

Both readings are load-bearing but reversible: they are two fields read in one function
(`applyEngineModifiers`), and both live in `src/math/chain.ts`.

### 4.3 Everything else is the spec, unchanged

Stats, Grade/Resonance, the damage formula, the modern 18-aspect chart with the two documented
fixes, stage-based crits, the 3/3 accuracy table, the 2/2 stat-stage table, statuses (including
the 20% thaw), turn order, the four-roll capture, the four growth curves with build-time lookup
tables, and evolution at 15/16 → 30 are implemented exactly as `sojutsu-battle-math.md` writes
them, including the deliberate HP quirk it tells us not to "fix".

The spec's own implementation order (§14) is the order they were built and tested in.

---

## 5. Finish mode — **[A-3]**

The Finish reference shows: enemy `FAINTED`, the player character stepping into the world with
the spear, an arc slash, and **the exploration deck returned** — joystick, dash, action button.

So the Finish is not a menu. When a wild spirit faints, the fight does not end; a Finish window
opens and the action button becomes the spear:

- **Tap → Sever.** The spear falls. XP, Resonance and money resolve per spec.
- **Hold → Bind.** A Binding Talisman is spent and the §9 capture rolls run, four rolls shown as
  four shakes. The chain you were holding when the enemy fainted raises the effective
  `TalismanBonus` — a held chain is worth something even after the fight is won.

This is why the deck reverts: Finish is played in the world, with the same thumb, in the same
place the exploration action button already lives.

Shrine and trainer battles skip Bind and force Sever.

---

## 6. Mathematics curriculum

The manga is unusually specific about *which* mathematics, and the progression maps cleanly onto
the three Phase One segments. Question banks live in `src/math/curriculum/` and are pure data.

| Band | Manga source | Content |
|---|---|---|
| **Tier 1** | p03 Fibonacci, p13 waystones, p32 "five spirits, two seals" | number bonds, single-digit `+ −`, doubles, counting on, sequence completion |
| **Tier 2** | p21 arrays, p32 times tables, p34 place value, p41 remainders, p45 two-step | tables to 12, `÷` with remainders, place value, halving/doubling, two-step `× then +`, equivalent fractions |
| **Tier 3** | p29 `156+78`, p43 `12×3−6`, p51 bar chart, p21 solids, p28 measurement | multi-digit `+ −`, multi-step expressions, tenths/decimals, mass/time/capacity, bar-chart reading, solid identification |

A question's band is `min(move.engine.mathTier, segmentCeiling)` so the campaign never poses a
Tier 3 question before Shrine 1. Every generated question carries its own `explain` string; a
drop shows the working, because the manga's mentors always show the working.

---

## 7. Art pipeline

No Aseprite CLI exists in this environment, so `tools/assets/` implements an
Aseprite-compatible exporter/packer in-repo: it emits standard Aseprite-format JSON hash
atlases (`frames` + `meta`) that Phaser loads natively and Aseprite can round-trip later.

Sources, in order of preference:

1. **Supplied art.** The 96 dex PNGs and the two character packs are used directly — downscaled
   with nearest-neighbour to overworld sizes, kept at source size for battle portraits.
2. **PixelLab REST** (`api.pixellab.ai/v1`) for everything not supplied: terrain, props, the two
   unshipped starters, NPCs, effects, UI furniture. Same generator that produced the supplied
   character packs, so the results sit in the same visual language.
3. **Procedural** fallback for pure-geometry UI so a build never blocks on a network call.

### 7.1 The 24 placeholder dex assets

Exactly **24 of the 96** dex PNGs are 64×64, 5-colour, sub-1 KB sprites where the other 72 are
512×512 full-colour RGBA. They are not random: they are precisely **every line's `Base` form** —
dex numbers 001, 005, 009 … 093, `GEARBIT_ASSET` among them. All three starters
(Fawnix, Spriglim, Frostel) are in this set, so the first spirit every player ever sees is one of
the placeholders.

They are real sprites, not corrupt files, so they work as a fallback and the game is never
blocked. But shipping the starter at 1/8th the fidelity of its own evolution is not acceptable,
so the pipeline detects them by dimension and regenerates those 24 species through PixelLab from
the catalogue's own description text. Originals are preserved untouched under `reference/` and
the regeneration is a separate, re-runnable step — a founder who prefers the placeholders can
drop the generated layer without touching the game.

---

## 8. Determinism and testing

Every random draw in `src/core` goes through a seeded xorshift128 `Rng`. Nothing calls
`Math.random`. A battle is therefore reproducible from `(seed, inputs)`, which is what makes the
damage formula testable against fixed vectors — the spec's §14 warning about retuning every
encounter after a late formula bug is taken literally.

- `src/core/**/*.test.ts` — the battle spec, worked examples from the document included.
- `src/math/**/*.test.ts` — chain curve, curriculum bands, answer validation.
- `tools/ingest/*.test.ts` — data integrity: every learnset move exists, every encounter species
  exists, every catch rate is present, every aspect resolves.
- `tools/verify/smoke.ts` — drives the real build in Chromium and screenshots all three modes.
