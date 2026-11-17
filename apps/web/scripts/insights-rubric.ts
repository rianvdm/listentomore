// ABOUTME: The insights eval's rubric: em dashes and negation contrast in a week note, read with the week's names
// ABOUTME: masked first so a title can't trip either. Pure, and used only by scripts/insights-eval.ts and its tests.

export type RubricHit = 'em-dash' | 'negation-contrast';

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The negation-contrast patterns of the round 2 summary prompt, verbatim from FORBIDDEN_CONSTRUCTION_PATTERNS in the
 * deleted packages/services/ai/src/prompts/user-insights-summary.ts (see commit 0b4a2cf).
 */
const NEGATION_CONTRAST_PATTERNS: RegExp[] = [
  // "It's not X, it's Y" / "That's not a discovery, that's a wing" / "This isn't X, it's Y"
  // (negation clause led by a copula/demonstrative, then a comma, then another copula/article)
  /\b(?:it'?s|that'?s|there'?s|you'?re|they'?re|we'?re|he'?s|she'?s|this|that|these|those)\b[^.?!\n]*?\b(?:not|isn'?t|aren'?t|wasn'?t|weren'?t)\b[^.?!\n]*?,\s*(?:it'?s|that'?s|you'?re|they'?re|we'?re|he'?s|she'?s|this|that|the|a|an)\b/i,
  // "not X but Y" / "not X — Y" (em-dash or double-hyphen dismissal)
  /\bnot\b[^.?!\n]*?(?:\bbut\b|—|--)/i,
  // "less like X, more like Y"
  /\bless\s+like\b[^.?!\n]*?\bmore\s+like\b/i,
];

/** What a masked name becomes: a plain word that none of the patterns above keys on. */
const NAME_PLACEHOLDER = 'Name';

const straightApostrophes = (s: string): string => s.replace(/[‘’]/g, "'");

/**
 * `text` with straight apostrophes and every whole occurrence of a name replaced by a placeholder, longest name first,
 * so "Great White" goes before "Great". Names match as given, case included: the model is told to write them exactly,
 * and a one-word name such as "Best" must not hide the word "best". A match must not run on into a letter or digit.
 */
export function maskNames(text: string, names: string[]): string {
  const sorted = [...new Set(names.map(straightApostrophes).filter((n) => n.trim() !== ''))]
    .sort((a, b) => b.length - a.length);
  let masked = straightApostrophes(text);
  for (const name of sorted) {
    masked = masked.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'gu'), NAME_PLACEHOLDER);
  }
  return masked;
}

/**
 * 'em-dash' and then 'negation-contrast' when the note has them, read with the week's names masked: "Not Waving But
 * Drowning got 12 plays" passes. Curly apostrophes read as straight ones, so "that’s not X, that’s Y" is caught too.
 */
export function checkEvalRubric(text: string, names: string[]): RubricHit[] {
  const masked = maskNames(text, names);
  const found: RubricHit[] = [];
  if (masked.includes('—')) found.push('em-dash');
  if (NEGATION_CONTRAST_PATTERNS.some((pattern) => pattern.test(masked))) found.push('negation-contrast');
  return found;
}
