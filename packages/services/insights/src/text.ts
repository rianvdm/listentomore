// ABOUTME: Text normalisation for matching artist, album and track names across Last.fm responses.
// ABOUTME: Matches norm() in the step0 build.py reference so keys agree with the research fixtures.

/** NFKC, lower-case, U+2010 hyphen to ASCII hyphen, collapse whitespace, trim. */
export function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/‐/g, '-').replace(/\s+/g, ' ').trim();
}
