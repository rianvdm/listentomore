// ABOUTME: Last.fm tag lists - stop and noise tags to drop, tags too broad to name a cluster, and genre buckets.
// ABOUTME: Copied from the step0 build.py reference; spec section 2 lets the lists grow from fixtures.

/** Tags that say nothing about the music (listening habits, nationalities). */
export const STOP_TAGS: ReadonlySet<string> = new Set([
  'seen live', 'favorites', 'favourite', 'favorite', 'male vocalists', 'female vocalists', 'american', 'british', 'usa', 'uk',
  'canadian', 'australian', 'german', 'icelandic', 'irish', 'french', 'swedish', 'all', 'south african',
]);

/**
 * Mood and quality words: they describe how music feels, not what it is, so a cluster named after one would read as an
 * adjective for music ("mellow artists"). Matched as whole tags, so genres that contain one ("dark ambient", "heavy
 * metal", "soft rock") are kept.
 */
const MOOD_TAGS = [
  'mellow', 'atmospheric', 'melancholic', 'melancholy', 'dreamy', 'chill', 'chillout', 'chilled', 'relaxing', 'relax', 'calm',
  'peaceful', 'soothing', 'sad', 'happy', 'beautiful', 'epic', 'dark', 'uplifting', 'emotional', 'energetic', 'haunting',
  'ethereal', 'moody', 'sexy', 'cool', 'fun', 'heavy', 'soft', 'loud', 'intense', 'acoustic', 'romantic', 'catchy', 'upbeat',
  'groovy', 'smooth', 'nostalgic', 'hypnotic', 'gentle', 'warm',
];

/** Stop tags plus instruments, places, praise and mood words: never a top tag for clusters. */
export const NOISE_TAGS: ReadonlySet<string> = new Set([
  ...STOP_TAGS,
  'instrumental', 'guitar', 'guitarist', 'saxophone', 'trumpet', 'piano', 'vocalists', 'female vocalist', 'male vocalist', 'my music',
  'albums i own', 'spotify', 'swiss', 'switzerland', 'canada', 'australia', 'england', 'scotland', 'sweden', 'germany', 'japan',
  'norwegian', 'danish', 'dutch', 'japanese', 'new zealand', 'love', 'awesome', 'cover', 'live',
  ...MOOD_TAGS,
]);

/** Tags too broad to name a genre cluster. */
export const BROAD_TAGS: ReadonlySet<string> = new Set([
  'rock', 'alternative', 'indie', 'pop', 'electronic', 'alternative rock', 'indie rock', 'indie pop', 'pop rock',
]);

/** Genre buckets in priority order: an artist's bucket is the first match for its first top-3 tag that has one. */
export const BUCKETS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
  ['worship/christian', new Set(['christian', 'worship', 'ccm', 'christian rock', 'gospel', 'praise', 'praise and worship',
    'contemporary christian', 'christian pop'])],
  ['ambient/modern classical', new Set(['ambient', 'drone', 'neoclassical', 'modern classical', 'contemporary classical', 'piano',
    'minimal', 'post-classical', 'neo-classical', 'new age', 'experimental', 'idm', 'downtempo', 'shoegaze', 'dream pop', 'post-rock'])],
  ['jazz', new Set(['jazz', 'nu jazz', 'fusion', 'smooth jazz', 'trumpet', 'hard bop', 'bebop', 'cool jazz', 'modal jazz', 'soul jazz',
    'jazz guitar', 'post-bop'])],
  ['synthwave/80s', new Set(['synthwave', 'retrowave', 'outrun', 'synthpop', 'new wave', '80s'])],
  ['trip-hop/electronic', new Set(['electronic', 'electronica', 'house', 'techno', 'chillwave', 'trip-hop', 'trip hop',
    'drum and bass', 'edm', 'big beat'])],
  ['rock/indie', new Set(['rock', 'indie rock', 'indie', 'alternative', 'alternative rock', 'classic rock', 'hard rock', 'post-punk',
    'blues rock', 'pop rock', 'progressive rock', 'blues', 'folk', 'singer-songwriter', 'americana', 'grunge', 'psychedelic',
    'soft rock', 'metal', 'heavy metal', 'punk'])],
  ['pop', new Set(['pop', 'indie pop', 'electropop'])],
];

/** How a bucket reads in a statement: plain words, with no digits or number words for the guard to read as quantities. */
export const BUCKET_LABELS: Readonly<Record<string, string>> = {
  'worship/christian': 'worship and Christian music',
  'ambient/modern classical': 'ambient and modern classical',
  jazz: 'jazz',
  'synthwave/80s': 'synthwave and new wave',
  'trip-hop/electronic': 'trip-hop and electronic',
  'rock/indie': 'rock and indie',
  pop: 'pop',
};

const TOP_TAGS = 3;
const NUMBER_WORD = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/;

/** Lower-cased, trimmed, non-empty tags without digits (decades and years say nothing about the genre). */
const usable = (raw: string[]): string[] =>
  raw.map((tag) => tag.toLowerCase().trim()).filter((tag) => tag !== '' && !/\d/.test(tag));

/**
 * An artist's top tags for clusters: raw Last.fm order minus noise tags, tags with digits and tags with a
 * number word (a cluster names its tag, and the guard would read 'two tone' as a quantity), first 3 kept.
 */
export function cleanTags(raw: string[]): string[] {
  return usable(raw).filter((tag) => !NOISE_TAGS.has(tag) && !NUMBER_WORD.test(tag)).slice(0, TOP_TAGS);
}

/**
 * The genre bucket of an artist, from its raw Last.fm tags. As in build.py, only stop tags are dropped here,
 * not every noise tag, so instrument tags such as 'piano' and 'trumpet' still place an artist in a bucket.
 */
export function bucketOf(tags: string[]): string | null {
  const top = usable(tags).filter((tag) => !STOP_TAGS.has(tag)).slice(0, TOP_TAGS);
  for (const tag of top) {
    for (const [bucket, members] of BUCKETS) if (members.has(tag)) return bucket;
  }
  return null;
}
