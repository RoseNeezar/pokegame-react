/**
 * Screen layout and palette.
 *
 * Every number here was measured off the three binding mode references in `reference/visual`,
 * then expressed as a ratio of the logical canvas so the layout survives any aspect ratio the
 * FIT scaler hands us. The references are 853 × 1844; the logical canvas is 540 × 1170, the
 * same 1:2.167 portrait shape, so `REF_SCALE` converts a measured reference pixel directly.
 *
 * The central structural fact, true in all three references: the world viewport never goes
 * away. Only the deck changes. See docs/DESIGN.md §3.
 */

export const LOGICAL_WIDTH = 540;
export const LOGICAL_HEIGHT = 1170;

/** Reference images are 853 px wide; multiply a measured reference pixel by this. */
export const REF_SCALE = LOGICAL_WIDTH / 853;

/** Converts a measurement taken off a reference image into logical pixels. */
export function ref(px: number): number {
  return Math.round(px * REF_SCALE);
}

/**
 * Where the control deck starts, as a fraction of canvas height.
 *
 * Measured boundaries: exploration 64.4%, math combat 61.4%, finish 60.4%. The mode references
 * disagree by a few percent because each was composed independently; 62% sits between them and
 * reads correctly against all three.
 */
export const DECK_TOP_RATIO = 0.62;

export const WORLD_HEIGHT = Math.round(LOGICAL_HEIGHT * DECK_TOP_RATIO);
export const DECK_TOP = WORLD_HEIGHT;
export const DECK_HEIGHT = LOGICAL_HEIGHT - DECK_TOP;

/* ------------------------------------------------------------------ palette */

/**
 * The palette is read off the references, not invented.
 *
 * The world is warm and lit (ember lanterns against wet blue-green foliage); the deck is a cold
 * near-black navy so the thumb furniture never competes with the scene. Combat swaps the deck
 * to parchment keys — the one place the UI goes bright, because that is where the player has to
 * read a number under time pressure.
 */
export const PALETTE = {
  /** Exploration / Finish deck ground — measured (20,25,35) and (16,20,30). */
  deckDark: 0x121a28,
  deckDarkEdge: 0x0a1018,
  /** Math-combat keypad ground — the deep navy behind the parchment keys. */
  deckNavy: 0x22305a,
  /** Parchment key face — measured (234,219,198). */
  key: 0xeadbc6,
  keyPressed: 0xd4c3aa,
  keyEdge: 0x1b2340,
  keyText: 0x1b2340,
  /** The OK key's confirming teal, and the general interactive accent. */
  accent: 0x2fc6b0,
  accentDim: 0x1c7a6d,
  /** Joystick and secondary button strokes — a cool pale grey. */
  stroke: 0xa8b4c4,
  strokeDim: 0x5a6472,
  /** Cyan used for the joystick knob rim, the dash chevrons and the action blade. */
  cyan: 0x74d8f0,
  cyanGlow: 0x2aa8cc,
  /** HUD panel ground and its warm brass frame. */
  panel: 0x1d2028,
  panelEdge: 0xb08a4a,
  panelEdgeDim: 0x6d5426,
  /** HP bar: healthy green, then amber, then red. */
  hpHigh: 0x8ed455,
  hpMid: 0xe8c23a,
  hpLow: 0xd9503f,
  hpTrack: 0x2c3140,
  /** The Chain bar, sitting under HP in the reference. */
  chain: 0x34b8dc,
  chainTrack: 0x243040,
  /** Text. */
  text: 0xf2ede2,
  textDim: 0x9aa3b0,
  ember: 0xff9a3c,
  danger: 0xd9503f,
} as const;

/* ------------------------------------------------- control-deck geometry */

/**
 * Exploration deck furniture, measured off `exploration-mode-reference.png`.
 * Reference coordinates are relative to the whole 853 × 1844 image.
 */
export const DECK = {
  /** Analogue stick, left thumb. */
  joystick: {
    cx: ref(220),
    cy: DECK_TOP + ref(360 - 174),
    outerRadius: ref(188),
    innerRadius: ref(90),
    knobRadius: ref(48),
    /** How far the knob may travel from centre. */
    travel: ref(140),
  },
  /** Dash / sprint, the `»` button. */
  dash: {
    cx: ref(519),
    cy: DECK_TOP + ref(665 - 174),
    radius: ref(65),
  },
  /** Primary action — spear strike in the world, Finish in the Finish window. */
  action: {
    cx: ref(694),
    cy: DECK_TOP + ref(563 - 174),
    radius: ref(92),
  },
  /** Backpack, sitting high-right over the deck. */
  backpack: {
    cx: ref(751),
    cy: DECK_TOP + ref(283 - 174),
    radius: ref(50),
  },
} as const;

/**
 * Math-combat deck furniture, measured off `math-combat-reference.png`.
 * The equation strip occupies the top of the deck; the keypad fills the rest.
 */
export const KEYPAD = {
  /** The "◀ BACK" pill, top-left of the deck. */
  back: { x: ref(30), y: DECK_TOP + ref(6), w: ref(155), h: ref(46) },
  /** The equation strip the question is drawn into. */
  equation: { x: ref(196), y: DECK_TOP + ref(2), w: ref(626), h: ref(52) },
  /** 3 columns × 4 rows. Key 1 sits at (30, 1155) in reference space. */
  origin: { x: ref(30), y: DECK_TOP + ref(1155 - 1100) },
  keyWidth: ref(253),
  keyHeight: ref(112),
  gapX: ref(26),
  gapY: ref(18),
  cornerRadius: ref(16),
} as const;

/**
 * Battle HUD panels, measured off the math-combat reference. The ally panel is left-aligned and
 * the foe panel is its mirror — portrait on the outside edge in both cases.
 */
export const HUD = {
  panel: { w: ref(310), h: ref(120), margin: ref(14) },
  portrait: ref(84),
  hpBar: { w: ref(168), h: ref(18) },
  chainBar: { w: ref(168), h: ref(14) },
  cornerRadius: ref(12),
} as const;

/** Depth bands. Actors sort against each other by feet-Y inside `actors`. */
export const DEPTH = {
  ground: 0,
  lowerProps: 100,
  animatedWater: 200,
  actors: 1000,
  overhead: 5000,
  lighting: 6000,
  weather: 6500,
  worldUi: 7000,
  deck: 8000,
  dialogue: 9000,
  overlay: 10000,
} as const;

/**
 * World tile size.
 *
 * 32 px puts about 17 × 23 tiles in the portrait viewport at exploration zoom, which is the
 * density the reference scenes read at: wide enough to see a path and where it goes, tight
 * enough that a spirit encounter fills the frame.
 */
export const TILE = 32;

/**
 * Camera behaviour per mode.
 *
 * Battle *pushes in* rather than cutting away — all three references are the same viewport on
 * the same scene, and that continuity is the point. The zooms are set from the references: the
 * player occupies roughly a twelfth of the frame while exploring and grows through combat into
 * the Finish, where the spear strike is the largest thing on screen.
 */
export const CAMERA = {
  exploreZoom: 1.6,
  battleZoom: 2.0,
  finishZoom: 2.4,
  pushMs: 520,
  lerp: 0.12,
} as const;
