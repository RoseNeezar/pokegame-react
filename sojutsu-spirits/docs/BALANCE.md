# Balance findings

Produced by simulating the actual fights the campaign sends the player into, not by reading the
tables. See `src/game/campaign.test.ts`, which runs these simulations on every test run.

Method: for each shrine, 60 fights at the level `sojutsu-battle-math.md` §13 recommends, with a
plausible party — the starter evolved to whatever form its level has reached, plus two spirits
caught in that region's own zones two levels below. The simulated player picks the
best-expected-damage move each turn, switches when a spirit falls, and answers **85%** of the
arithmetic correctly.

---

## Shrine 3's ace is under-powered — a finding in the supplied spec

| Shrine | Keeper | Ace | Stage | BST | Ace level | Player level | Simulated win rate |
|---|---|---|---|---|---|---|---|
| 1 | Tok Ranting | Leaflark | Stage 2 | 345 | 14 | 12 | in band |
| 2 | Tok Sungai | Glacisaur | **Final A** | **425** | 22 | 20 | in band |
| 3 | Tok Batu | Burrosaur | Stage 2 | 345 | 29 | 30 | **60 / 60** |

Ace power runs **345 → 425 → 345** while the player's own line runs **265 → 355 → 435**. By
Shrine 3 the player's starter is a Final A at BST 435 and the ace is a Stage 2 at 345, seven
levels of growth behind. Shrine 3 cannot lose.

This is not an implementation fault. `sojutsu-battle-math.md` §13 names Burrosaur as the
Shrine 3 ace explicitly, sourced to "part1-campaign-bible-2026-08-06.html, founder decision 21,
2026-08-07". **The data has been implemented exactly as supplied and deliberately not retuned.**

### The three ways to fix it, for the founder to choose

1. **Promote the ace within its own line.** `Ferradillo` is Burrosaur's Final A — Ground/Steel,
   BST 425 — and would put Shrine 3 in line with Shrine 2. One word changes in
   `PART_ONE_REGIONS`. This is the smallest change and the one that matches Shrine 2's shape.
2. **Raise the ace's level.** Keeping Burrosaur but at Lv 34–36 buys some of the gap back, though
   a Stage 2 will always lose the stat race to a Final A eventually.
3. **Give the keeper a team.** Shrines currently field one spirit. A three-spirit shrine team
   would fix the difficulty *and* make the Aspect chart matter at the moment the game most wants
   it to. This is the largest change and the best game.

Until one is chosen, `SOFT_ACES` in `src/game/campaign.test.ts` records the exception, so the
moment Shrine 3 is retuned the test starts guarding it again.

---

## What the simulation confirms is working

- **Every shrine is beatable at its recommended level** with a plausible party and no grinding,
  which is what §13 asks for ("enough to demand Aspect coverage without demanding grinding").
- **Shrine 2 is the hard one**, correctly. A lone starter loses it badly (9/60 in an earlier
  run); a party built from the region's own encounter tables wins comfortably. The fight is a
  check on whether the player engaged with the route, which is the right thing for it to check.
- **The arithmetic decides fights.** At a 95% solve rate the player wins materially more often
  than at 25%, at every shrine. If that stopped being true, the game would be a monster battler
  with a keypad glued to it — so it is asserted, per shrine, on every test run.
- **No fight ever stalls.** 300 battles per run reach a terminal state.
- **The level bands are coherent.** No zone sends a wild spirit above its region's ace, bands
  rise monotonically through each region, and grinding a region's last zone gets the player
  within reach of the next shrine's recommendation.

---

## Party switching

Battles were single-spirit when first built, which made Shrine 2 look unwinnable. That was a
missing feature, not a balance problem: `sojutsu-battle-math.md` §0 sets the Bound Circle at six
and §6 says stages reset on switch-out — both are meaningless without switching.

Switching is now implemented per §8: it resolves before attacks and costs the turn; a faint lets
the player send out a replacement for free; and XP is split between every participant per §10.
