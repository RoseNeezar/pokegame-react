# SOJUTSU — Complete Battle & Progression Math

Reference spec for all calculations. Formulas follow Gen-1 lineage (matching the stat
tables in `sojutsu_spirit_data.csv`) with noted modern upgrades where the original had
bugs worth not inheriting.

---

## 0. Terminology

| System term | Sojutsu term |
|---|---|
| Monster / Pokémon | **Cursed Spirit** (or *Spirit*) |
| Trainer | **Sojutsuka** (spear-binder) |
| Capture item | **Binding Talisman** |
| Gym | **Shrine** |
| Badge | **Sigil** |
| Type | **Aspect** |
| Party | **Bound Circle** (max 6) |

---

## 1. Stat Calculation

Two values feed every stat: **Grade** (0–15, the spirit's innate quality, rolled on
encounter) and **Resonance** (0–65535, accumulated through battle).

### HP
```
HP = floor( ((Base + Grade) × 2 + floor(√Resonance / 4)) × Level / 100 ) + Level + 10
```

### Attack / Defense / Speed / Special
```
Stat = floor( ((Base + Grade) × 2 + floor(√Resonance / 4)) × Level / 100 ) + 5
```

HP is the only stat with `+ Level + 10` instead of `+ 5`. This is what makes HP scale
far faster than everything else, and it is deliberate — do not "fix" it.

### Grade rolls
Roll Attack, Defense, Speed, Special each as `random(0..15)`. Derive HP Grade from the
least-significant bit of each:

```
HP_Grade = (Atk_Grade & 1) × 8 + (Def_Grade & 1) × 4 + (Spd_Grade & 1) × 2 + (Spc_Grade & 1)
```

This ties a perfect HP roll to specific combinations elsewhere, so "perfect" spirits are
genuinely rare rather than just uncommon.

### Resonance gain
On defeating a spirit, each participant gains that species' **base stat** into the
matching Resonance pool. Cap 65535 per stat. Contribution is `floor(√Resonance / 4)`,
so it maxes at +63 to each stat — meaningful but never dominant.

### Worked example — Fawnix (starter, Base HP 41) at Lv 20

```
Perfect Grade (15), zero Resonance:
  ((41 + 15) × 2 + 0) × 20/100 = 112 × 0.2 = 22.4 → 22
  22 + 20 + 10 = 52 HP

Worst Grade (0), zero Resonance:
  ((41 + 0) × 2 + 0) × 20/100 = 82 × 0.2 = 16.4 → 16
  16 + 20 + 10 = 46 HP
```

A 6 HP spread at Lv 20 — noticeable but not decisive, which is the right feel.

---

## 2. Damage

```
Base = floor( floor( floor(2 × Level × Crit / 5 + 2) × Power × A / D ) / 50 ) + 2

Damage = Base × STAB × Aspect × Random
```

| Term | Value |
|---|---|
| `Crit` | 2 on a critical hit, else 1 |
| `A` | Attacker's Attack (physical) or Special (special) |
| `D` | Defender's Defense (physical) or Special (special) |
| `STAB` | 1.5 if move Aspect matches user's Aspect, else 1.0 |
| `Aspect` | Product of the effectiveness chart (see §3) |
| `Random` | `random(217..255) / 255` — a 0.851–1.000 spread |

If `Aspect = 0`, damage is 0 and the move reports no effect. Minimum damage on any
connecting hit is **1**.

### Fixed-damage exceptions
- **Gravity Slam** (Seismic Toss analog) — damage = user's level, ignores stats
- **Draconic Burst** (Dragon Rage analog) — flat 40
- **Mind Pulse** (Psywave analog) — `random(1 .. floor(Level × 1.5))`
- **Retaliate** (Counter analog) — 2× physical damage last taken this turn
- **OHKO moves** — deal `MaxHP`, fail entirely if target's Speed > user's Speed

### Recoil & drain
- Recoil: user takes `floor(damage_dealt / 4)`
- Drain: user heals `floor(damage_dealt / 2)`
- Self-destruct class: user faints, and the target's Defense is **halved** for the calc

---

## 3. Aspect Effectiveness

Multipliers multiply together. A dual-Aspect defender can hit ×4 or ×0.25.

```
Immune      0.0
Resisted    0.5
Neutral     1.0
Effective   2.0
```

Recommended chart for the 15 Aspects in your dex (Normal, Fire, Water, Grass, Electric,
Ice, Fighting, Poison, Ground, Flying, Psychic, Bug, Rock, Ghost, Dragon, Dark, Steel,
Fairy). Two corrections to the Gen-1 chart worth adopting:

- **Ghost hits Psychic for 2×** (Gen 1 had this as 0× by bug, which broke the meta)
- **Ice resists itself** — prevents your three Ice finals from being mirror-match coinflips

Because Dark, Steel and Fairy appear throughout your dex, use the modern chart, not
Gen 1's 15-type version.

---

## 4. Critical Hits

Gen 1 tied crit rate to base Speed, which made fast spirits absurd. Use stage-based:

| Stage | Chance | Trigger |
|---|---|---|
| 0 | 1/24 | default |
| +1 | 1/8 | high-crit moves (Slash-class) |
| +2 | 1/2 | high-crit + focus item |
| +3 | Always | stacked |

Critical hits **ignore the defender's Defense buffs and the attacker's Attack debuffs**,
and multiply the level term by 2 (see §2).

---

## 5. Accuracy & Evasion

```
HitChance = MoveAccuracy × (AccStage / EvaStage)
```

Stage multipliers use the 3/3 table (distinct from the 2/2 stat table in §6):

| Stage | −6 | −4 | −2 | 0 | +2 | +4 | +6 |
|---|---|---|---|---|---|---|---|
| Mult | 0.33 | 0.43 | 0.60 | 1.00 | 1.66 | 2.33 | 3.00 |

Cap final hit chance at **100%**, and floor it at **1/256** — never let a move become
literally unmissable or unusable.

---

## 6. Stat Stage Modifiers

Applies to Attack, Defense, Speed, Special. Range −6 to +6.

```
Stage > 0:  multiplier = (2 + stage) / 2
Stage < 0:  multiplier = 2 / (2 - stage)
```

| Stage | −6 | −4 | −2 | 0 | +2 | +4 | +6 |
|---|---|---|---|---|---|---|---|
| Mult | 0.25 | 0.33 | 0.50 | 1.00 | 2.00 | 3.00 | 4.00 |

Stages reset on switch-out. `Blade Ritual` (Swords Dance analog) is +2 Attack, which is
why it scored Impact 5 in your move table — one turn for a doubled Attack stat.

---

## 7. Status Conditions

### Damage over time (end of turn)

| Status | Damage | Notes |
|---|---|---|
| Poison | `floor(MaxHP / 8)` | flat |
| Burn | `floor(MaxHP / 16)` | also **halves Attack** |
| Venom Curse (Toxic) | `floor(MaxHP × n / 16)` | n increments each turn; resets on switch |

Minimum 1 damage per tick. A spirit cannot be reduced below 1 HP by weather-class chip
unless you intend fainting from status.

### Non-damaging

| Status | Effect | Duration |
|---|---|---|
| Paralysis | Speed × 0.25; 25% chance to skip turn | until cured |
| Sleep | cannot act | `random(1..7)` turns |
| Freeze | cannot act; **20% thaw chance per turn** | until thawed |
| Flinch | skips turn | 1 turn, only if struck first |
| Confusion | 33% chance to hit self for 40 power, no Aspect | `random(2..5)` turns |

Gen 1 freeze was permanent without an item — a genuine design bug. The 20% thaw above is
the fix; keep it.

---

## 8. Turn Order

1. Compare move **priority** (Shadow Jab = +1, standard = 0, retreat moves = −1)
2. If tied, compare effective **Speed** (after paralysis and stage modifiers)
3. If still tied, **random**

Switching resolves before all attacks. Fleeing uses:
```
FleeChance = (UserSpeed × 32 / ((TargetSpeed / 4) mod 256) + 30 × attempts) / 256
```

---

## 9. Capture

```
a = ((3 × MaxHP − 2 × CurrentHP) × CatchRate × TalismanBonus) / (3 × MaxHP) × StatusBonus
b = 1048560 / √(√(16711680 / a))
```

Roll `random(0..65535)` four times; capture succeeds if **all four** rolls < `b`.
Number of rolls that pass = number of shakes shown, so near-misses feel near.

| Modifier | Value |
|---|---|
| Basic Talisman | 1.0 |
| Great Talisman | 1.5 |
| Ultra Talisman | 2.0 |
| Sleep / Freeze | 2.5 |
| Paralysis / Poison / Burn | 1.5 |

**Recommended CatchRate by stage:** Base 190–255, Stage 2 90–120, Final 45. Set the three
Rare lines (Cherubick, Wickisp, Roswyrm) to **45 even at Base** — rarity should mean hard
to *keep*, not merely hard to find.

---

## 10. Experience & Levelling

### XP awarded
```
XP = floor( (BaseYield × DefeatedLevel) / 7 ) / participants
```
Apply ×1.5 for traded spirits.

### Growth curves — total XP to reach level *n*

| Curve | Formula | Used by |
|---|---|---|
| Fast | `0.8n³` | — |
| Medium Fast | `n³` | most lines |
| Medium Slow | `1.2n³ − 15n² + 100n − 140` | the three starters |
| Slow | `1.25n³` | Cherubick, Wickisp, Roswyrm |

At Lv 30 (full evolution): Medium Slow 21,760 · Medium Fast 27,000 · Slow 33,750.

### Level from XP
No closed inverse — precompute a 100-entry lookup table per curve at build time and
binary-search it. Do not solve the cubic at runtime.

---

## 11. Evolution

### Level triggers (all lines fully evolved by Lv 30)

| Curve | Base → Stage 2 | Stage 2 → Final |
|---|---|---|
| Medium Fast | Lv 15 | Lv 30 |
| Medium Slow / Slow | Lv 16 | Lv 30 |

Check evolution **after** the XP award resolves and only when the level actually
increments. Evolution recalculates all stats immediately using the new Base values —
Grade and Resonance carry over unchanged.

### Branch trigger (Final A vs Final B)

Since Final B is deferred to v2, **v1 evolves every Stage 2 straight into Final A** with
no condition. Ship it that way.

When v2 lands, the recommended trigger — because it needs no items and reads as thematic
"the spirit becomes what you fed it":

```
if (Resonance_Attack > Resonance_Special)  → Final B
else                                       → Final A
```

The player shapes the outcome purely through which spirits they chose to fight. Fallback
option if that proves too opaque in playtest: a **Warding Charm** / **Severing Charm**
held-item pair, which is legible but less elegant.

---

## 12. Money

```
PrizeMoney = BaseMoney × HighestLevel × Sigils_Owned_Multiplier
Loss on blackout = floor(PlayerMoney / 2)
```

---

## 13. Recommended Level Curve

Six shrines total.

| Milestone | Player level | Shrine ace |
|---|---|---|
| Route 1 | 3–5 | — |
| Route 2 | 5–8 | — |
| Verdant Thicket | 7–11 | — |
| **Shrine 1** | 12 | **Lv 14 (Leaflark)** |
| Segment 2 routes | 14–20 | — |
| **Shrine 2** | 20 | **Lv 22 (Glacisaur)** |
| Segment 3 routes | 22–29 | — |
| **Shrine 3** | 30 | **Lv 29 (Burrosaur)** |

Shrine aces sit ~2 levels above the expected player level. That is enough to demand
Aspect coverage without demanding grinding.

Part-1 aces per part1-campaign-bible-2026-08-06.html (founder decision 21, 2026-08-07).

### Obedience cap
Traded spirits above your Sigil ceiling disobey:

| Sigils | Obeys up to |
|---|---|
| 0 | Lv 15 |
| 1 | Lv 25 |
| 2 | Lv 35 |
| 3 | Lv 42 (starting value pending Part-2 ace levels) |
| 4 | Lv 49 (starting value pending Part-2 ace levels) |
| 5 | Lv 56 (starting value pending Part-2 ace levels) |
| 6 | all |

---

## 14. Implementation Order

1. Stats (§1) — everything else reads from these
2. Aspect chart (§3) — pure data, testable in isolation
3. Damage (§2) — the core loop
4. Turn order (§8), status (§7), stages (§6)
5. XP and evolution (§10, §11)
6. Capture (§9) — last; it depends on max/current HP being correct

Unit-test §2 against a fixed RNG seed before building anything on top of it. A damage
formula bug found after the encounter tables are tuned means retuning every encounter.
