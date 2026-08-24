/**
 * Shared curriculum vocabulary.
 *
 * The three bands are written as independent modules so a band can be retuned without reading
 * the other two, but they must agree on how a number is *spoken* — a sequence is printed the
 * same way in Tier 1 and Tier 3, "quarters" means the same thing everywhere, and the operator
 * glyphs have to match the equation strip in `math-combat-reference.png`, which shows `×`.
 * Anything two bands share lives here so it can only be written once.
 */

/** The glyphs the equation strip draws. `×` is taken from the binding visual reference. */
export const OP = {
  times: '×',
  divide: '÷',
  plus: '+',
  minus: '−',
} as const;

/** `[2, 4, 6]` → `"2, 4, 6, ?"`. Every sequence question in every band prints like this. */
export function sequencePrompt(terms: readonly number[]): string {
  return `${terms.join(', ')}, ?`;
}

/** Tenths as a decimal string: `46` → `"4.6"`. Avoids `toFixed` drift on the join. */
export function tenthsToDecimal(tenths: number): string {
  const whole = Math.floor(tenths / 10);
  const part = tenths % 10;
  return `${whole}.${part}`;
}

/** `9` → `"09"`. Clock questions only ever print a 24-hour, zero-padded time. */
export function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

/** Place-value column names, indexed by power of ten. */
export const PLACE_NAMES: readonly string[] = ['ones', 'tens', 'hundreds', 'thousands'];

/**
 * Fraction denominators spoken as words.
 *
 * Only the denominators the equivalent-fraction template can actually reach are listed; an
 * unreachable key would be dead data pretending to be coverage.
 */
export const DENOMINATOR_WORDS: Readonly<Record<number, string>> = {
  2: 'halves',
  3: 'thirds',
  4: 'quarters',
  5: 'fifths',
  6: 'sixths',
  8: 'eighths',
  9: 'ninths',
  10: 'tenths',
  12: 'twelfths',
  15: 'fifteenths',
  16: 'sixteenths',
  20: 'twentieths',
};

/** Bar-chart categories. Five weekdays is what fits the strip at a readable size. */
export const DAY_LABELS: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/**
 * Things the bar charts count. Drawn from the manga's own settings so the arithmetic sits in
 * the world rather than on a worksheet.
 */
export const CHART_SUBJECTS: readonly string[] = ['props', 'seals', 'lanterns', 'crates'];

/**
 * Solids for identification.
 *
 * Curved solids appear here and nowhere else. Asking how many faces a cylinder has is a
 * genuinely contested question at this level (2 or 3, depending on the syllabus), so the
 * counting template below restricts itself to polyhedra where the answer is not a matter of
 * convention.
 */
export const SOLIDS: readonly string[] = [
  'cube',
  'cuboid',
  'cylinder',
  'cone',
  'sphere',
  'square pyramid',
  'triangular prism',
];

export interface SolidCounts {
  readonly faces: number;
  readonly edges: number;
  readonly vertices: number;
  /** The one-line description used to build the working. */
  readonly note: string;
}

/** Polyhedra only — every count here is unambiguous. */
export const POLYHEDRON_COUNTS: Readonly<Record<string, SolidCounts>> = {
  cube: { faces: 6, edges: 12, vertices: 8, note: '6 square faces, 12 edges, 8 vertices' },
  cuboid: { faces: 6, edges: 12, vertices: 8, note: '6 rectangular faces, 12 edges, 8 vertices' },
  'square pyramid': {
    faces: 5,
    edges: 8,
    vertices: 5,
    note: '1 square base, 4 triangles, 8 edges, 5 vertices',
  },
  'triangular prism': {
    faces: 5,
    edges: 9,
    vertices: 6,
    note: '2 triangle ends, 3 rectangles, 9 edges, 6 vertices',
  },
  'triangular pyramid': {
    faces: 4,
    edges: 6,
    vertices: 4,
    note: '4 triangular faces, 6 edges, 4 vertices',
  },
};

export type SolidCountKey = 'faces' | 'edges' | 'vertices';

export interface UnitConversion {
  readonly from: string;
  readonly to: string;
  readonly factor: number;
  /** Which quantity this is, for the working line. */
  readonly quantity: 'mass' | 'length' | 'capacity';
}

/** Measurement conversions, all of which turn a one-decimal value into a whole number. */
export const UNIT_CONVERSIONS: readonly UnitConversion[] = [
  { from: 'kg', to: 'g', factor: 1000, quantity: 'mass' },
  { from: 'km', to: 'm', factor: 1000, quantity: 'length' },
  { from: 'L', to: 'ml', factor: 1000, quantity: 'capacity' },
  { from: 'm', to: 'cm', factor: 100, quantity: 'length' },
];

/**
 * The working for `a × b`, written the way a mentor writes it.
 *
 * Three strategies, chosen by the size of the larger factor: partition into tens and ones for
 * anything past ten, lean on the five times table in the middle, and count it out for the small
 * ones. All three are real primary-school methods; none of them is "because I said so".
 */
export function explainProduct(a: number, b: number): string {
  const big = Math.max(a, b);
  const small = Math.min(a, b);
  const product = a * b;
  const tens = Math.floor(big / 10) * 10;
  const ones = big % 10;

  if (tens > 0 && ones > 0) {
    return `${a} ${OP.times} ${b} = (${tens} ${OP.times} ${small}) + (${ones} ${OP.times} ${small}) = ${tens * small} + ${ones * small} = ${product}`;
  }
  if (big > 5) {
    const rest = big - 5;
    return `${a} ${OP.times} ${b} = (5 ${OP.times} ${small}) + (${rest} ${OP.times} ${small}) = ${5 * small} + ${rest * small} = ${product}`;
  }
  const counted = Array.from({ length: big }, () => String(small)).join(' + ');
  return `${a} ${OP.times} ${b} = ${counted} = ${product}`;
}
