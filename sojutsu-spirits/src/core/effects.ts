/**
 * Move-effect parsing.
 *
 * The unified move catalogue describes every rider in prose ("Sharply raises Defense",
 * "May burn 10%", "Recoil damage to user"). That prose is the only machine-readable statement
 * of what 104 moves actually do, so it is parsed once, here, into typed riders — rather than
 * being re-interpreted ad hoc at each call site.
 *
 * Parsing is strict about what it recognises and silent about what it does not: an unrecognised
 * effect string yields a move that simply deals its damage, which is always safe. The
 * `coverage` test asserts that the recognised set stays above a floor, so a data change that
 * introduces new wording is caught rather than quietly ignored.
 */
import type { MoveDef, StageKey, StatusKind } from './types.ts';

export interface ParsedEffect {
  /** Stage changes applied to the user. */
  readonly userStages: ReadonlyArray<readonly [StageKey, number]>;
  /** Stage changes applied to the target. */
  readonly targetStages: ReadonlyArray<readonly [StageKey, number]>;
  readonly inflicts: StatusKind | null;
  readonly confuses: boolean;
  readonly flinch: boolean;
  /** Probability for a chance-based rider; 1 for a guaranteed one. */
  readonly inflictChance: number;
  readonly recoil: boolean;
  readonly drain: boolean;
  readonly selfDestruct: boolean;
  readonly healsUser: boolean;
  readonly highCrit: boolean;
  readonly neverMisses: boolean;
  readonly forcesSwitch: boolean;
  readonly escapesBattle: boolean;
  readonly copiesLastMove: boolean;
  /** Charge-turn Defense boost (Headlong Charge). */
  readonly chargeDefenseUp: boolean;
  /** User must spend the following turn recharging (Overload Beam). */
  readonly recharge: boolean;
  /** Puts up a decoy that absorbs damage (Decoy Form). */
  readonly substitute: boolean;
  /** Attack rises whenever the user is struck (Fury Build). */
  readonly attackRisesWhenHit: boolean;
  /** Resolves as a counter on a later turn (Patient Fury). */
  readonly delayedCounter: boolean;
  /** Picks a random effect on use (Wildcard). */
  readonly randomEffect: boolean;
  /** True when the parser recognised at least one rider. */
  readonly recognised: boolean;
  /**
   * True when the catalogue explicitly declares there is no rider — "None (OHKO)",
   * "None (2-turn)", "None (fixed)", "None (priority)". These are statements, not gaps: the
   * behaviour they name lives in `engine.multiTurn`, `engine.priority` or the fixed-damage
   * table, so they must not be counted as parse failures.
   */
  readonly declaredNone: boolean;
}

const EMPTY: ParsedEffect = {
  userStages: [],
  targetStages: [],
  inflicts: null,
  confuses: false,
  flinch: false,
  inflictChance: 1,
  recoil: false,
  drain: false,
  selfDestruct: false,
  healsUser: false,
  highCrit: false,
  neverMisses: false,
  forcesSwitch: false,
  escapesBattle: false,
  copiesLastMove: false,
  chargeDefenseUp: false,
  recharge: false,
  substitute: false,
  attackRisesWhenHit: false,
  delayedCounter: false,
  randomEffect: false,
  recognised: false,
  declaredNone: false,
};

const STAT_WORDS: Record<string, StageKey> = {
  attack: 'attack',
  atk: 'attack',
  defense: 'defense',
  defence: 'defense',
  def: 'defense',
  speed: 'speed',
  spd: 'speed',
  special: 'special',
  // Gen-1 lineage: Special is one stat for both special attack and special defense, so every
  // spelling the catalogue uses collapses onto it.
  sp: 'special',
  'sp.': 'special',
  'sp. atk': 'special',
  'sp. def': 'special',
  'special attack': 'special',
  'special defense': 'special',
  accuracy: 'accuracy',
  evasion: 'evasion',
};

const STATUS_WORDS: Array<[RegExp, StatusKind]> = [
  [/badly\s+poison/i, 'venom'],
  [/poison/i, 'poison'],
  [/burn/i, 'burn'],
  [/paraly[sz]/i, 'paralysis'],
  [/sleep|puts?\s+.*\bto sleep\b|drowsy/i, 'sleep'],
  [/freeze|frozen/i, 'freeze'],
];

const cache = new Map<string, ParsedEffect>();

export function parseMoveEffect(move: MoveDef): ParsedEffect {
  const key = `${move.id}|${move.effect ?? ''}|${move.powerNote ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const parsed = parse(move);
  cache.set(key, parsed);
  return parsed;
}

function parse(move: MoveDef): ParsedEffect {
  const text = `${move.effect ?? ''} ${move.powerNote ?? ''}`.trim();
  if (!text) return EMPTY;

  const userStages: Array<readonly [StageKey, number]> = [];
  const targetStages: Array<readonly [StageKey, number]> = [];
  let inflicts: StatusKind | null = null;
  let confuses = false;
  let flinch = false;
  let inflictChance = 1;
  let recoil = false;
  let drain = false;
  let selfDestruct = false;
  let healsUser = false;
  let highCrit = false;
  let neverMisses = false;
  let forcesSwitch = false;
  let escapesBattle = false;
  let copiesLastMove = false;
  let chargeDefenseUp = false;
  let recharge = false;
  let substitute = false;
  let attackRisesWhenHit = false;
  let delayedCounter = false;
  let randomEffect = false;
  let recognised = false;

  const lower = text.toLowerCase();

  // "May burn 10%" / "30% chance to flinch"
  const pct = /(\d{1,3})\s*%/.exec(lower);
  if (pct) inflictChance = Math.min(1, Number(pct[1]) / 100);
  else if (/^may\b|\bmay\b/.test(lower)) inflictChance = 0.3;

  // Stage changes. Handles "Sharply raises Defense (self)", "Lowers target accuracy",
  // "Lowers Sp. Atk (30%)" and "Atk rises when hit".
  const stageRe =
    /(sharply\s+)?(raises|lowers|boosts|reduces)\s+(?:the\s+)?(?:target(?:'s)?\s+|foe(?:'s)?\s+|opponent(?:'s)?\s+|user(?:'s)?\s+)?(sp\.\s*atk|sp\.\s*def|special\s+attack|special\s+defense|sp\.?|[a-z]+)(\s*\(self\))?/gi;
  let m: RegExpExecArray | null;
  while ((m = stageRe.exec(text)) !== null) {
    const word = m[3]!.toLowerCase().replace(/\s+/g, ' ').trim();
    const stat = STAT_WORDS[word] ?? STAT_WORDS[word.replace(/\.$/, '')];
    if (!stat) continue;
    const magnitude = m[1] ? 2 : 1;
    const up = /raise|boost/i.test(m[2]!);
    const delta = up ? magnitude : -magnitude;
    // A raise defaults to the user, a lower defaults to the target — the usual convention.
    // An explicit "(self)" or an explicit "target"/"foe" overrides it either way.
    const saysTarget = /target|foe|opponent/i.test(m[0]!);
    const saysSelf = Boolean(m[4]) || /user/i.test(m[0]!);
    const onSelf = saysSelf ? true : saysTarget ? false : up;
    (onSelf ? userStages : targetStages).push([stat, delta] as const);
    recognised = true;
  }

  for (const [re, kind] of STATUS_WORDS) {
    if (re.test(lower)) {
      inflicts = kind;
      recognised = true;
      break;
    }
  }

  if (/confus/i.test(lower)) {
    confuses = true;
    recognised = true;
  }
  if (/flinch/i.test(lower)) {
    flinch = true;
    if (inflictChance === 1) inflictChance = 0.3;
    recognised = true;
  }
  if (/recoil/i.test(lower)) {
    recoil = true;
    recognised = true;
  }
  if (/drain|absorb|leech|heals user by half the damage/i.test(lower)) {
    drain = true;
    recognised = true;
  }
  if (/user faints|self-?destruct/i.test(lower)) {
    selfDestruct = true;
    recognised = true;
  }
  if (/heals user|restores hp|recover/i.test(lower) && !drain) {
    healsUser = true;
    recognised = true;
  }
  if (/high crit|critical.*rate|crit ratio/i.test(lower)) {
    highCrit = true;
    recognised = true;
  }
  if (/never misses|cannot miss/i.test(lower)) {
    neverMisses = true;
    recognised = true;
  }
  if (/forces switch|switch.*out/i.test(lower)) {
    forcesSwitch = true;
    recognised = true;
  }
  if (/escapes battle|flee|run away/i.test(lower)) {
    escapesBattle = true;
    recognised = true;
  }
  if (/copies last move|mirror/i.test(lower)) {
    copiesLastMove = true;
    recognised = true;
  }
  if (/def up on charge/i.test(lower)) {
    chargeDefenseUp = true;
    recognised = true;
  }

  if (/recharge/i.test(lower)) {
    recharge = true;
    recognised = true;
  }
  if (/substitute|decoy/i.test(lower)) {
    substitute = true;
    recognised = true;
  }
  if (/\b(atk|attack)\s+rises\s+when\s+hit/i.test(lower)) {
    attackRisesWhenHit = true;
    recognised = true;
  }
  if (/delayed\s+counter/i.test(lower)) {
    delayedCounter = true;
    recognised = true;
  }
  if (/^random$/i.test((move.effect ?? '').trim()) || /\brandom effect\b/i.test(lower)) {
    randomEffect = true;
    recognised = true;
  }

  // "None (OHKO)" / "None (2-turn)" / "None (fixed)" / "None (priority)" are the catalogue
  // stating that a move has no rider; the named behaviour lives in engine flags or the
  // fixed-damage table. Recording it keeps these out of the parse-failure count.
  // Only when no rider was found: "None (never misses)" both declares no rider *and* states
  // one, and the stated one is what matters.
  const declaredNone = !recognised && /^none\b/i.test(text.trim());

  // Slash-class moves are the documented +1 crit stage (§4) even when the prose omits it.
  if (move.tier === 'Signature' && /slash|cleave|rend/i.test(move.name)) highCrit = true;

  // Two riders the battle-math document states directly and the catalogue prose understates.
  // §6: "Blade Ritual (Swords Dance analog) is +2 Attack, which is why it scored Impact 5."
  if (move.id === 'blade-ritual') {
    userStages.length = 0;
    userStages.push(['attack', 2] as const);
    recognised = true;
  }

  return {
    userStages,
    targetStages,
    inflicts,
    confuses,
    flinch,
    inflictChance,
    recoil,
    drain,
    selfDestruct,
    healsUser,
    highCrit,
    neverMisses,
    forcesSwitch,
    escapesBattle,
    copiesLastMove,
    chargeDefenseUp,
    recharge,
    substitute,
    attackRisesWhenHit,
    delayedCounter,
    randomEffect,
    recognised,
    declaredNone,
  };
}
