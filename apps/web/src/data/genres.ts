// Comprehensive list of music genres in slug format
// Used for genre search and random genre selection

export const GENRES = [
  'acid-jazz',
  'afrobeat',
  'alt-rock',
  'alternative',
  'ambient',
  'avant-garde',
  'black-metal',
  'bluegrass',
  'blues',
  'bossanova',
  'breakbeat',
  'cantopop',
  'chillwave',
  'classical',
  'country',
  'dance',
  'dark-ambient',
  'death-metal',
  'deep-house',
  'disco',
  'doom-metal',
  'drone',
  'drum-and-bass',
  'dub',
  'dubstep',
  'dream-pop',
  'edm',
  'electro',
  'electroclash',
  'electronic',
  'emo',
  'folk',
  'folk-metal',
  'funk',
  'garage',
  'glitch',
  'gospel',
  'goth',
  'grindcore',
  'grunge',
  'hard-bop',
  'hard-rock',
  'hard-trance',
  'hardcore',
  'heavy-metal',
  'hip-hop',
  'house',
  'idm',
  'indie',
  'indie-pop',
  'industrial',
  'j-pop',
  'jazz',
  'jungle',
  'k-pop',
  'krautrock',
  'kwaito',
  'latin',
  'mandopop',
  'math-rock',
  'metal',
  'metalcore',
  'metropopolis',
  'neoclassical',
  'new-age',
  'new-wave',
  'norwegian-black-metal',
  'nu-metal',
  'opera',
  'pop',
  'post-dubstep',
  'post-rock',
  'power-pop',
  'progressive-house',
  'progressive-rock',
  'psych-rock',
  'punk',
  'punk-rock',
  'r-n-b',
  'reggae',
  'riot-grrrl',
  'rock',
  'rockabilly',
  'shoegaze',
  'singer-songwriter',
  'ska',
  'ska-punk',
  'sludge-metal',
  'soul',
  'synth-pop',
  'synthwave',
  'techno',
  'trance',
  'trip-hop',
  'vaporwave',
  'world-music',
] as const;

export type GenreSlug = (typeof GENRES)[number];

// Convert slug to display name (e.g., "indie-rock" -> "Indie Rock")
export function slugToDisplayName(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Convert display name to slug (e.g., "Indie Rock" -> "indie-rock")
export function displayNameToSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

// Get a random genre
export function getRandomGenre(): { slug: string; displayName: string } {
  const slug = GENRES[Math.floor(Math.random() * GENRES.length)];
  return {
    slug,
    displayName: slugToDisplayName(slug),
  };
}
