// ABOUTME: Title and name matching between Last.fm and Spotify: a folded match key, edition markers and stripping
// ABOUTME: edition suffixes, so a release date is only used for the record the listener played (spec section 2).

import { norm } from './text';

/** Words that mark a reissue or another edition, which Spotify dates by the edition rather than the original. */
const EDITION_MARKER = /\b(?:remaster(?:ed)?|deluxe|anniversary|edition|expanded|reissue|alternative master)\b/i;
const DASH_SEPARATOR = ' - ';

/** norm(), '&' as 'and', accents dropped, every run of other than letters and digits as one space, trimmed. */
export function matchKey(s: string): string {
  return norm(s)
    .replace(/&/g, ' and ')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** True when the title names a remaster, deluxe, anniversary, expanded or other edition, or a reissue. */
export function hasEditionMarker(title: string): boolean {
  return EDITION_MARKER.test(title);
}

/** The title's last '(...)', '[...]' or ' - ...' segment and the text before it, or null when it has none. */
function lastSegment(title: string): { head: string; segment: string } | null {
  const close = title.endsWith(')') ? '(' : title.endsWith(']') ? '[' : null;
  const at = close !== null ? title.lastIndexOf(close) : title.lastIndexOf(DASH_SEPARATOR);
  if (at < 0) return null;
  return { head: title.slice(0, at), segment: title.slice(at) };
}

/** Drops trailing '(...)', '[...]' or ' - ...' segments that carry an edition marker, one after another. */
export function stripEdition(title: string): string {
  let out = title.trim();
  for (let last = lastSegment(out); last !== null; last = lastSegment(out)) {
    const head = last.head.trim();
    if (!head || !hasEditionMarker(last.segment)) break;
    out = head;
  }
  return out;
}
