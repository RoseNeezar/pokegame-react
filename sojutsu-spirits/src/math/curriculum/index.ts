/**
 * The curriculum, assembled.
 *
 * One module per band, one table joining them. The generator never reaches past this file, so
 * adding a question kind is a two-line change in one band module plus one entry here — and the
 * curriculum test walks `ALL_TEMPLATES`, which means a new kind cannot ship without a verifier
 * proving its prompt and its answer agree.
 *
 * Pure data and pure functions. No Phaser, no clock, no `Math.random`.
 */
import type { MathTier, QuestionTemplate } from '../question.ts';
import { TIER1_TEMPLATES } from './tier1.ts';
import { TIER2_TEMPLATES } from './tier2.ts';
import { TIER3_TEMPLATES } from './tier3.ts';

export { TIER1_TEMPLATES } from './tier1.ts';
export { TIER2_TEMPLATES } from './tier2.ts';
export { TIER3_TEMPLATES } from './tier3.ts';

export const TEMPLATES_BY_TIER: Readonly<Record<MathTier, readonly QuestionTemplate[]>> = {
  1: TIER1_TEMPLATES,
  2: TIER2_TEMPLATES,
  3: TIER3_TEMPLATES,
};

export const ALL_TEMPLATES: readonly QuestionTemplate[] = [
  ...TIER1_TEMPLATES,
  ...TIER2_TEMPLATES,
  ...TIER3_TEMPLATES,
];

/** Every kind a band can produce. Used by the HUD's kind labels and by the coverage test. */
export function kindsForTier(tier: MathTier): readonly string[] {
  return TEMPLATES_BY_TIER[tier].map((t) => t.kind);
}
