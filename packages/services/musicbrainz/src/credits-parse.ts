// ABOUTME: Pure parsers for MusicBrainz credits: pick a release group and its earliest official release,
// ABOUTME: read release credits at release, recording and track level, and read an artist's band links.

import type { ArtistBands, Credit, CreditArtist, ReleaseCredits } from './credits-types';

/** Search results below this score are too loose to trust for a title match. */
const MIN_RELEASE_GROUP_SCORE = 90;

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asStrings(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

function asArtist(value: unknown): CreditArtist | null {
  const record = asRecord(value);
  const id = asString(record?.id);
  const name = asString(record?.name);
  return id && name ? { id, name } : null;
}

/**
 * Fold a title for comparison: NFKC, lower case, Latin accents removed, and every run of
 * non-alphanumerics (any script) collapsed to one space. A title made only of punctuation
 * falls back to its NFKC, lower-cased form so it does not fold to the empty string.
 */
function foldTitle(title: string): string {
  const base = title.normalize('NFKC').toLowerCase().trim();
  const folded = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return folded || base;
}

/**
 * Pick the release group for an album from a `/release-group` search response.
 * Candidates need a score of 90 or more and a folded title equal to the album's.
 * Albums win over other primary types, then the higher score; ties keep MusicBrainz's order.
 */
export function pickReleaseGroup(search: unknown, album: string): string | null {
  const wanted = foldTitle(album);
  const candidates = asArray(asRecord(search)?.['release-groups'])
    .map(asRecord)
    .filter((group): group is Json => group !== null)
    .map((group) => ({
      id: asString(group.id),
      score: Number(group.score),
      title: asString(group.title),
      isAlbum: group['primary-type'] === 'Album',
    }))
    .filter((group) => group.id !== null && group.title !== null)
    .filter((group) => group.score >= MIN_RELEASE_GROUP_SCORE && foldTitle(group.title as string) === wanted);

  candidates.sort((a, b) => Number(b.isAlbum) - Number(a.isAlbum) || b.score - a.score);
  return candidates[0]?.id ?? null;
}

/**
 * Pick the earliest official release from a `/release-group/<id>?inc=releases` lookup.
 * Dates compare as strings, so '2002' sorts before '2002-09-24'. An undated official
 * release is used only when no official release has a date.
 */
export function pickEarliestOfficial(releaseGroup: unknown): string | null {
  const official = asArray(asRecord(releaseGroup)?.releases)
    .map(asRecord)
    .filter((release): release is Json => release !== null && release.status === 'Official')
    .map((release) => ({ id: asString(release.id), date: asString(release.date) }))
    .filter((release): release is { id: string; date: string | null } => release.id !== null);

  const dated = official.filter((release): release is { id: string; date: string } => release.date !== null);
  if (dated.length > 0) {
    dated.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return dated[0].id;
  }
  return official[0]?.id ?? null;
}

function creditArtists(artistCredit: unknown): CreditArtist[] {
  const seen = new Set<string>();
  const artists: CreditArtist[] = [];
  for (const entry of asArray(artistCredit)) {
    const artist = asArtist(asRecord(entry)?.artist);
    if (artist && !seen.has(artist.id)) {
      seen.add(artist.id);
      artists.push(artist);
    }
  }
  return artists;
}

function relationCredits(relations: unknown, level: Credit['level']): Credit[] {
  const credits: Credit[] = [];
  for (const entry of asArray(relations)) {
    const relation = asRecord(entry);
    const type = asString(relation?.type);
    const artist = asArtist(relation?.artist);
    if (relation?.['target-type'] === 'artist' && type && artist) {
      credits.push({ artist, type, attributes: asStrings(relation.attributes), level });
    }
  }
  return credits;
}

/**
 * Read a `/release/<id>?inc=artist-credits+recordings+artist-rels+recording-level-rels` lookup.
 * Credits come from release relations, then recording relations, then track artists who are
 * not album artists (as 'performer'). A person's credit counts once per type and attribute set;
 * the first level it appears at is kept.
 */
export function parseReleaseCredits(release: unknown): ReleaseCredits {
  const record = asRecord(release);
  const artists = creditArtists(record?.['artist-credit']);
  const albumArtistIds = new Set(artists.map((artist) => artist.id));

  const all: Credit[] = [...relationCredits(record?.relations, 'release')];
  const tracks = asArray(record?.media).flatMap((medium) => asArray(asRecord(medium)?.tracks).map(asRecord));
  for (const track of tracks) {
    all.push(...relationCredits(asRecord(track?.recording)?.relations, 'recording'));
  }
  for (const track of tracks) {
    const trackCredit = track?.['artist-credit'] ?? asRecord(track?.recording)?.['artist-credit'];
    for (const artist of creditArtists(trackCredit)) {
      if (!albumArtistIds.has(artist.id)) {
        all.push({ artist, type: 'performer', attributes: [], level: 'track' });
      }
    }
  }

  const seen = new Set<string>();
  const credits = all.filter((credit) => {
    const key = JSON.stringify([credit.artist.id, credit.type, [...credit.attributes].sort()]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { releaseId: asString(record?.id) ?? '', artists, credits };
}

/**
 * Read an `/artist/<id>?inc=artist-rels` lookup into band links.
 * Only `member of band` relations to an artist count: forward links are bands this artist
 * played in, backward links are this band's members. Links with a 'touring' attribute are
 * dropped. Repeat stints in one band merge, and the link is ended only if every stint ended.
 */
export function parseArtistBands(artist: unknown): ArtistBands {
  const record = asRecord(artist);
  const memberOf = new Map<string, { band: CreditArtist; ended: boolean }>();
  const members = new Map<string, { person: CreditArtist; ended: boolean }>();

  for (const entry of asArray(record?.relations)) {
    const relation = asRecord(entry);
    const other = asArtist(relation?.artist);
    if (!relation || !other || relation.type !== 'member of band' || relation['target-type'] !== 'artist') continue;
    if (asStrings(relation.attributes).some((attribute) => attribute.toLowerCase() === 'touring')) continue;

    const ended = relation.ended === true;
    if (relation.direction === 'forward') {
      const existing = memberOf.get(other.id);
      memberOf.set(other.id, { band: existing?.band ?? other, ended: (existing?.ended ?? true) && ended });
    } else if (relation.direction === 'backward') {
      const existing = members.get(other.id);
      members.set(other.id, { person: existing?.person ?? other, ended: (existing?.ended ?? true) && ended });
    }
  }

  return {
    artist: asArtist(record) ?? { id: asString(record?.id) ?? '', name: asString(record?.name) ?? '' },
    type: asString(record?.type),
    memberOf: [...memberOf.values()],
    members: [...members.values()],
  };
}
