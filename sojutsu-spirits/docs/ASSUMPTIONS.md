# Assumptions

The handoff names the master prompt as "the current product authority" and says it will be
pasted alongside the archive. It was not supplied. Everything below is a decision that the
master prompt would plainly have made, reconstructed from the artefacts that *were* supplied.

Each one is isolated behind a single constant, table or function so a founder correction is a
data edit rather than a rewrite. The "Where" column is the only place you need to change.

---

## [A-1] The Chain multiplier curve

**Decision.** `chainMultiplier = 1 + 0.10 × min(chain, 20)`.

**Why.** The manga gives four multiplier readings and one break point, and this single
continuous curve fits all of them:

| Source | Reading | Curve gives |
|---|---|---|
| p17 | `×1.2` on a short chain | chain 2 → ×1.2 |
| p18 | "your chain held past six" — a threshold worth naming | chain 6 → ×1.6 |
| p31–32 | "your chain broke at seven. Every time. Same place." | — |
| p44 | "I drop them at nine now instead of three." | chain 9 → ×1.9 |
| p48 | a 12-link chain reaching "TEN" at `×2` | chain 10 → ×2.0 |
| p04 | `×3`, spoken by a veteran | chain 20 → ×3.0 |

Ten is the mid-game landmark the manga treats as hard-won; twenty is the mastery ceiling.

**Where.** `CHAIN_STEP` and `CHAIN_CAP` in `src/math/chain.ts`.

**If wrong.** Change the two constants. Nothing else reads the curve directly.

---

## [A-2] `crgModifier` and `radModifier`

**Decision.**
- **CRG — Chain Rate Gain.** Multiplies the chain gained on a correct solve.
- **RAD — Response Allowance Duration.** Multiplies the answer timer. **`0` means no question
  is posed at all**; the move auto-resolves and grants no new chain.

**Why.** `sojutsu-moves-unified.json` attaches these to all 104 moves and defines them nowhere
in the bundle. Their distributions are unambiguous about shape:

- `radModifier = 0` on exactly two moves — **Detonate** and **Cataclysm Burst**, which are
  exactly the two moves whose effect is "User faints". You do not need arithmetic to blow
  yourself up.
- `radModifier = 1.2` on exactly the six multi-turn charge moves (the question is posed during
  the charge turn, so there is longer to answer); `0.8` on cheap utility and the one priority
  move (a fast move demands a fast answer).
- `crgModifier = 1.35` on exactly those same six charge moves (a two-turn commitment is worth
  more chain); `0.8` on cheap utility.

No other reading explains why the `0` lands on precisely the two self-faint moves.

**Where.** `applyEngineModifiers` and `posesQuestion` in `src/math/chain.ts`. Two fields, one
function.

**If wrong.** The likeliest alternative is that RAD governs how much chain survives a drop
rather than the timer length. That is a change to one function.

---

## [A-3] What the Finish actually is

**Decision.** When a wild spirit faints the battle does not end. A Finish window opens, the deck
reverts to the exploration controls, and the action button becomes the spear:
**tap → Sever** (XP, Resonance, money), **hold → Bind** (spend a talisman, run the §9 capture
rolls, four rolls shown as four shakes). The chain held when the spirit fell raises the
effective talisman bonus. Shrine and trainer battles force Sever.

**Why.** `finish-mode-reference.png` shows the enemy `FAINTED`, the player stepping in with the
spear, an arc slash — and the *exploration deck returned*, joystick and all. A menu would not
need the joystick back. The deck reverting is the reference telling us the Finish is played in
the world with the same thumb, on the button that is already there.

**Where.** `enterFinish` / `onFinishTap` / `onFinishHold` in
`src/game/scenes/BattleOverlay.ts`; `BIND_HOLD_MS` in `src/ui/ControlDeck.ts`.

---

## [A-4] Part-One shrine order: Grass → Water → Ground

**Decision.** R1 Meadow (Tok Ranting, Grass, Leaflark Lv 14) → R2 Riverside (Tok Sungai, Water,
Glacisaur Lv 22) → R3 Highland (Tok Batu, Ground, Burrosaur Lv 29).

**Why.** Two supplied sources disagree. `sojutsu_progression.csv` lists segment 2 as Ground and
segment 3 as Water. Against it: `sojutsu-battle-math.md` §13 names the aces in the order above;
`sojutsu-encounters.json` is regenerated "per founder decision 21 (2026-08-07)" into R1 Meadow /
R2 Riverside / R3 Highland; and the manga agrees twice over — the keepers are met in the order
Ranting (bark, root, rot), Sungai (river, silt, pull), Batu (stone), and the licence book on
p49 is stamped leaf, then wave, then stone.

Three sources to one, and the majority are the newer ones. `sojutsu_progression.csv` segments
2–3 are treated as superseded.

**Where.** `PART_ONE_REGIONS` in `tools/ingest/index.ts`; `ZONES` in
`src/game/world/zones.ts`. A test asserts the two agree.

---

## [A-5] The curriculum bands

**Decision.** Three bands mapped to `move.engine.mathTier`, capped by the campaign's
`segmentCeiling` (Tier 1 until Sigil 1, Tier 2 until Sigil 2, Tier 3 after).

**Why.** The manga is unusually specific about *which* mathematics, and every band below is
sourced from a panel — number bonds and sequences (p03, p13, p32), times tables and remainders
and place value (p21, p32, p34, p41), multi-step and measurement and data (p28, p29, p43, p45,
p51). What the manga does not state is the gating, and posing a bar-chart question on Route 1
would be absurd, so the sigils gate it.

**Where.** `src/math/curriculum/`, and `segmentCeiling` in `src/game/state.ts`.

---

## [A-6] Every answer is a non-negative integer

**Decision.** No question in the game has a negative, fractional or decimal answer.

**Why.** This is not a preference, it is dictated by the input device.
`math-combat-reference.png` shows the keypad in full: `1-9`, backspace, `0`, `OK`. There is no
minus key, no decimal point and no fraction bar. A question whose answer cannot be typed is a
bug, so decimals are asked as counts ("3.4 kg in hundred-gram weights") and geometry is asked as
a numbered choice.

**Where.** Enforced at generation time in `src/math/question.ts`, and asserted over thousands of
generated questions in `src/math/question.test.ts`.

---

## [A-7] Blade Ritual is +2 Attack

**Decision.** Blade Ritual raises Attack by two stages, not one.

**Why.** The move catalogue's prose says only "Raises Attack (self)". `sojutsu-battle-math.md`
§6 says directly: "Blade Ritual (Swords Dance analog) is +2 Attack, which is why it scored
Impact 5 in your move table — one turn for a doubled Attack stat." The document beats the
catalogue's understated wording.

**Where.** The override at the end of `parse()` in `src/core/effects.ts`.

---

## [A-8] Encounter terrain underground

**Decision.** Outdoors, wild spirits are met in tall grass. In Echo Cavern, which has no grass
at all, they are met on the loose rubble floor.

**Why.** Echo Cavern ships an approved encounter table. A cavern painted with stone and floor
tiles and a grass-only encounter rule is a table that can never fire. Caught by a test.

**Where.** `ENCOUNTER_TERRAIN` in `src/game/world/generate.ts`.

---

## [A-9] The world is generated, not hand-authored

**Decision.** Zone terrain is produced by a deterministic seeded generator that emits exactly
the layer set the research bundle specifies.

**Why.** The bundle's recommended shipping path is a hand-authored "hero plate" per map with
Tiled metadata layers, and it is right — but no such plates were supplied, and neither was a
map editor or a brief for them. The generator is built to be *replaced* by them: it produces
ground, lower props, animated water, overhead, collision, spawns and triggers behind the same
interface, so dropping in a hand-made plate changes no scene code.

**Where.** `src/game/world/generate.ts`, consumed only through `ZoneRenderer`.

---

## Open questions for the founder

1. **The master prompt itself.** Everything above is downstream of its absence.
2. **CRG / RAD** — [A-2] is the highest-leverage guess in the build. One sentence settles it.
3. **The 24 placeholder Base forms.** They are regenerated through PixelLab; confirm that is
   wanted rather than shipping the supplied 64 × 64 five-colour sprites.
4. **Part 2.** `sojutsu-encounters.json` carries an unnormalised eleven-zone skeleton for
   segments 4–6 and the dex carries 24 Final B forms marked "reserved for v2". Both are
   ingested and validated but not shipped.
