// ABOUTME: The insights rubric: taste words, em dashes and negation contrast in a weekly note, plus the copy rubric's
// ABOUTME: overused words and announcing openers from avoid-ai-patterns.md, with names masked first. Pure.

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

/** Plural or third person: -es after s, sh, ch, x or o ('harnesses', 'echoes'), -ies after a consonant y, else -s. */
function withS(word: string): string {
  if (/(?:s|sh|ch|x|o)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** A regular verb's forms, base, -s, past and -ing, with a final e dropped first ('showcased', 'showcasing'). */
function verb(base: string, irregular: string[] = []): string[] {
  const stem = base.endsWith('e') ? base.slice(0, -1) : base;
  return [base, withS(base), `${stem}ed`, `${stem}ing`, ...irregular];
}

/** A noun's forms: the base and its plural, plus any listed derivative such as 'ghostly'. */
const noun = (base: string, extra: string[] = []): string[] => [base, withS(base), ...extra];

/**
 * The overused words in avoid-ai-patterns.md (product-ai/01-context), every item in its lists, each with the forms it is
 * caught in. Forms are per entry so a different word built on one passes: 'highlighter', 'seamer' and 'whisperer' are
 * not inflections. A noun that is also a verb ('echoed', 'shaped') takes the verb forms.
 */
const OVERUSED_WORDS: Array<[entry: string, forms: string[]]> = [
  ...['delve', 'underscore', 'highlight', 'showcase', 'leverage', 'utilize', 'facilitate', 'foster', 'navigate',
    'garner', 'craft', 'harness', 'boast', 'surpass'].map((base): [string, string[]] => [base, verb(base)]),
  ['intricate', ['intricate', 'intricately']],
  ['meticulous', ['meticulous', 'meticulously']],
  ['swift', ['swift', 'swifter', 'swiftest', 'swiftly']],
  ['adept', ['adept', 'adeptly']],
  ['liminal', ['liminal']],
  ['spectral', ['spectral']],
  ['crucial', ['crucial', 'crucially']],
  ['pivotal', ['pivotal']],
  ['robust', ['robust', 'robustly']],
  ['seamless', ['seamless', 'seamlessly']],
  ['transformative', ['transformative']],
  ['groundbreaking', ['groundbreaking', 'ground-breaking']],
  ['cutting-edge', ['cutting-edge']],
  ['nuanced', ['nuanced']],
  ['multifaceted', ['multifaceted', 'multi-faceted']],
  ['sharp', ['sharp', 'sharper', 'sharpest', 'sharply']],
  ['load-bearing', ['load-bearing']],
  ['tapestry', noun('tapestry')],
  ['journey', verb('journey')],
  ['echo', verb('echo')],
  ['whisper', verb('whisper')],
  ['shadow', verb('shadow', ['shadowy'])],
  ['ghost', verb('ghost', ['ghostly'])],
  ['landscape', noun('landscape')],
  ['realm', noun('realm')],
  ['paradigm', noun('paradigm')],
  ['ecosystem', noun('ecosystem')],
  ['synergy', noun('synergy')],
  ['seam', noun('seam')],
  ['throughline', noun('throughline')],
  ['shape', verb('shape')],
  ['quiet', ['quiet', 'quieter', 'quietest', 'quietly']],
  // 'humming' and 'woven' are entries of their own, so 'hum' and 'weave' leave them out and each is named once.
  ['hum', ['hum', 'hums', 'hummed']],
  ['humming', ['humming']],
  ['woven', ['woven']],
  ['weave', verb('weave', ['wove'])],
  ...['deeply', 'fundamentally', 'remarkably', 'genuinely', 'truly', 'incredibly', 'arguably', 'notably',
    'interestingly', 'importantly'].map((word): [string, string[]] => [word, [word]]),
];

/** The overused phrases in avoid-ai-patterns.md, each with the wordings it is caught in. */
const OVERUSED_PHRASES: Array<[entry: string, wordings: string[]]> = [
  ["it's worth noting", ["it's worth noting", 'it is worth noting']],
  ['it bears mentioning', ['it bears mentioning']],
  ['as mentioned', ['mentioned', 'noted', 'stated', 'said'].flatMap((verbed) =>
    ['above', 'earlier', 'before', 'previously'].map((when) => `as ${verbed} ${when}`))],
  ['cannot be overstated', ['cannot be overstated', "can't be overstated", 'can not be overstated']],
  ['a testament to', ['a testament to']],
  ['paving the way', ['pave the way', 'paves the way', 'paved the way', 'paving the way']],
  ['unlock the potential', ['unlock the potential', 'unlocks the potential', 'unlocked the potential', 'unlocking the potential']],
  ['at the end of the day', ['at the end of the day']],
  ['what stood out', ['what stood out', 'what stands out']],
  ['jumped out at me', ['jumped out at me', 'jumps out at me']],
  ['caught my attention', ['caught my attention', 'catches my attention']],
  ['what I keep coming back to', ['what I keep coming back to']],
  ['I keep thinking about', ['I keep thinking about']],
  ['in conclusion', ['in conclusion']],
  ['to sum up', ['to sum up']],
  ['in summary', ['in summary']],
  ['in disguise', ['in disguise']],
  ['dressed up as', ['dressed up as']],
  ['wearing different clothes', ['wearing different clothes']],
  ['serves as', ['serve as', 'serves as', 'served as', 'serving as']],
  ['stands as', ['stand as', 'stands as', 'stood as', 'standing as']],
];

/** A phrase's words with any run of whitespace between them, and a hyphen matching a hyphen or whitespace. */
const phraseSource = (phrase: string): string =>
  phrase.split(/[\s-]+/).map(escape).join(phrase.includes('-') ? '[-\\s]+' : '\\s+');

/** Whole-word match, case-insensitive: no letter or digit on either side, so 'craft' never matches 'spacecraft'. */
const wholeWord = (source: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'iu');

const OVERUSED_PATTERNS: Array<{ entry: string; pattern: RegExp }> = [
  ...[...OVERUSED_WORDS, ...OVERUSED_PHRASES]
    .map(([entry, wordings]) => ({ entry, pattern: wholeWord(wordings.map(phraseSource).join('|')) })),
  // "In today's [fast-paced/digital/...] [world/landscape/age]": the adjectives vary, so it is a pattern.
  {
    entry: "in today's world",
    pattern: wholeWord(String.raw`in\s+today's\s+(?:[\p{L}-]+\s+){0,2}(?:world|landscape|age|era)`),
  },
];

/** The start of the copy or of a sentence in it, then any opening quotes or brackets, straight or curly. */
const SENTENCE_START = String.raw`(?:^|[.!?:]["'”’)\]]*\s+)["'“”‘’(\[]*`;

/**
 * 'announcing': an opener that announces the fact before giving it ("Fun facts:", "“Here’s the fact"), a punchline
 * announcement anywhere ("here's the kicker"), and a soft announcement that ends in a colon ("The idea is simple:",
 * "My take is this:", "I think about it like this:").
 */
const ANNOUNCING_PATTERNS: RegExp[] = [
  new RegExp(
    `${SENTENCE_START}(?:here's|here\\s+is|here\\s+are|fun\\s+facts?|did\\s+you\\s+know|the\\s+best\\s+parts?|`
    + `but\\s+here's\\s+the\\s+thing)(?![\\p{L}\\p{N}])`,
    'iu',
  ),
  wholeWord(String.raw`here's\s+(?:the\s+)?(?:kicker|thing|move|catch|twist|part|something)|the\s+(?:move|play)(?:\s+here)?\s+is`),
  wholeWord(String.raw`(?:is|was)\s+(?:this|simple|clear|easy|straightforward)\s*:|like\s+this\s*:`),
];

/**
 * 'negation contrast' beyond the note rubric's loud forms: the quiet variants ("rather than", "instead of", "not only",
 * "less about"), the causal "not because", and the two-sentence "It isn't X. It's Y." for any X: "It isn't music. It's
 * magic." and "It isn't live. It's overdubbed." both count. Copy states a correction positively instead. A fact that
 * leaves the frame, "It was not released in 1997. It came out in 1998.", passes.
 */
const NEGATION_CONTRAST_COPY_PATTERNS: RegExp[] = [
  wholeWord(String.raw`rather\s+than|instead\s+of|not\s+only|less\s+about|not\s+(?:just\s+|only\s+|simply\s+)?because`),
  new RegExp(
    String.raw`(?:\b(?:isn't|wasn't|aren't|weren't)|(?:\b(?:is|was|are|were)|'s|'re)\s+not)\b[^.?!;]*[.?!;]`
    + String.raw`["'”’)]*\s+["'“‘(]*(?:it|this|that|they|these|those|he|she)(?:'s|'re|\s+(?:is|was|are|were))\b`,
    'i',
  ),
];

/**
 * 'rhetorical question': a question of one to four words that the copy answers itself ("The result? A barn."). A
 * question in quotation marks is a quote, never a rhetorical question, and telling a quote from an apostrophe is
 * unreliable ("the bands' van"), so the check runs only on copy with no quotation marks at all. See QUOTATION_MARK.
 */
const RHETORICAL_QUESTION_PATTERN = new RegExp(`${SENTENCE_START}(?:[^\\s.?!]+\\s+){0,3}[^\\s.?!]+\\?["'”’)]*\\s+\\S`, 'u');

/**
 * Any quotation mark: any \p{Quotation_Mark} character (straight and curly quotes, guillemets, low quotes, CJK corner
 * brackets 「」『』, the fullwidth ＂), except that a straight or curly single quote between two letters is an
 * apostrophe. An apostrophe inside a word (don't, O'Brien) doesn't count; a trailing possessive (bands') does, so that
 * copy skips the rhetorical-question check. A missed question next to a quote is the accepted cost.
 */
const QUOTATION_MARK = /(?!['‘’])\p{Quotation_Mark}|(?<!\p{L})['‘’]|['‘’](?!\p{L})/u;

/** `word` with its first letter in either case, for a pattern that can't take the 'i' flag. */
const eitherCase = (word: string): string => `[${word[0].toUpperCase()}${word[0]}]${word.slice(1)}`;

const KEY_LEAD_INS = ['in', 'on', 'to', 'from', 'of', 'and', 'was', 'is', 'note', 'key'].map(eitherCase).join('|');

/**
 * A musical key is not the overused adjective: "sharp" or "flat" right after an uppercase note letter, with or without
 * a hyphen ("C sharp", "F-sharp minor", "B flat"). B to G are always a key, and so is a hyphenated "A-sharp". A capital
 * A followed by a space can be the article ("A sharp essay"), so "A sharp" is a key only after "in", "on", "to",
 * "from", "of", "and", "was", "is", "note", "key" or a comma, or before "minor", "major" or clause-ending punctuation.
 */
const MUSICAL_KEY_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:`
  + String.raw`(?:[B-G](?:-|\s+)|A-)(?:[Ss]harp|[Ff]lat)`
  + String.raw`|(?<=(?:(?<![\p{L}\p{N}])(?:${KEY_LEAD_INS})\s+|,\s*))A\s+(?:[Ss]harp|[Ff]lat)`
  + String.raw`|A\s+(?:[Ss]harp|[Ff]lat)(?=\s+(?:${eitherCase('minor')}|${eitherCase('major')})(?![\p{L}\p{N}])|\s*[,.;:!?)])`
  + String.raw`)(?![\p{L}\p{N}])`,
  'gu',
);

/**
 * The one exception to the overused words: the literal "a quiet week", the site's own line for a week with few plays.
 * It is masked before the overused check, so "quiet" anywhere else, "a quiet weekend" and "quietly" included, still
 * counts.
 */
const QUIET_WEEK_PATTERN = /(?<![\p{L}\p{N}])a\s+quiet\s+week(?![\p{L}\p{N}])/giu;

/**
 * checkNoteRubric for any user-visible copy (tie-back templates, making-of facts), plus 'announcing', 'negation
 * contrast' for the copy-only variants, 'rhetorical question', and 'overused:<entry>' for each overused word or phrase
 * in list order. All of these read the copy with the names masked, so a name can't trigger them, and musical keys and
 * "a quiet week" are masked before the overused check. Each item is named once.
 */
export function checkCopyRubric(text: string, names: string[]): string[] {
  const found = checkNoteRubric(text, names);
  const masked = maskNames(text, names).trim();
  const add = (item: string): void => {
    if (!found.includes(item)) found.push(item);
  };
  if (ANNOUNCING_PATTERNS.some((pattern) => pattern.test(masked))) add('announcing');
  if (NEGATION_CONTRAST_COPY_PATTERNS.some((pattern) => pattern.test(masked))) add('negation contrast');
  if (!QUOTATION_MARK.test(masked) && RHETORICAL_QUESTION_PATTERN.test(masked)) add('rhetorical question');
  const forOverused = masked.replace(MUSICAL_KEY_PATTERN, 'Key').replace(QUIET_WEEK_PATTERN, 'a week');
  for (const { entry, pattern } of OVERUSED_PATTERNS) {
    if (pattern.test(forOverused)) add(`overused:${entry}`);
  }
  return found;
}
