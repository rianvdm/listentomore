// ABOUTME: The insights eval's rubric: taste words, hedges, em dashes and negation-contrast constructions in a weekly
// ABOUTME: note, with the week's artist and album names masked first. Pure, so the eval script and its tests share it.

/** Whole words and phrases a note must not use: taste, sound, first person and guesses at the listener. */
const BANNED_PHRASES = [
  'best',
  'great',
  'gorgeous',
  'lush',
  'sounds like',
  'for me',
  "I'd",
  'still holds up',
  'says a lot',
  'clearly',
  'must have',
];

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case-insensitive, whole-word, any run of whitespace between words: 'best' never matches 'Bestival'. */
const PHRASE_PATTERNS = BANNED_PHRASES.map((phrase) => ({
  item: phrase,
  pattern: new RegExp(`\\b${phrase.split(' ').map(escape).join('\\s+')}\\b`, 'i'),
}));

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

/** What a masked name becomes: a plain word that no banned phrase contains. */
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

/** The banned words and phrases in `text`, in BANNED_PHRASES order. */
const phraseHits = (text: string): string[] =>
  PHRASE_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ item }) => item);

/** 'em dash' and 'negation contrast', when `text` has them. */
function constructionHits(text: string): string[] {
  const found: string[] = [];
  if (text.includes('—')) found.push('em dash');
  if (NEGATION_CONTRAST_PATTERNS.some((pattern) => pattern.test(text))) found.push('negation contrast');
  return found;
}

/**
 * The banned items found in a note, each named once, in the order above, then 'em dash', then 'negation contrast'.
 * Curly apostrophes read as straight ones, so "I’d" and "that’s not X, that’s Y" are caught too.
 */
export function checkRubric(text: string): string[] {
  return checkNoteRubric(text, []);
}

/**
 * checkRubric for a note about a week with these artist and album names: the banned words are read with the names
 * masked, so "Great White got 8 plays" passes and "Great White was great" does not. The em dash and negation
 * contrast are read on the original text, since a name cannot excuse either.
 */
export function checkNoteRubric(text: string, names: string[]): string[] {
  return [...phraseHits(maskNames(text, names)), ...constructionHits(straightApostrophes(text))];
}
