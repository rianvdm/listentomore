// ABOUTME: Uncached Last.fm reads for the insights pipeline - time-ranged scrobbles, weekly charts, top lists, info and tags.
// ABOUTME: Parses error bodies before status, retries rate limits twice with backoff, and never caches or logs request URLs.

import { fetchWithTimeout } from '@listentomore/shared';

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0/';

/** Last.fm error code for an unknown artist, album, track or user. */
const ERROR_NOT_FOUND = 6;
/** Last.fm error code for a rate limit; HTTP 429 means the same. */
const ERROR_RATE_LIMIT = 29;
/** Waits before each retry of a rate-limited call, in milliseconds. Its length is the retry cap. */
const RETRY_DELAYS_MS = [1000, 2000];
const RECENT_TRACKS_LIMIT = 200;
const CHART_LIMIT = 1000;
const TOP_ARTISTS_LIMIT = 1000;

export type HistoryPeriod = '3month' | '6month' | '12month' | 'overall';

export interface HistoryScrobble {
  artist: string;
  album: string;
  track: string;
  ts: number;
}

export interface HistoryConfig {
  apiKey: string;
  username: string;
}

/**
 * A failed Last.fm call. `code` is Last.fm's error number when the body carried one, else null.
 * The message names the API method and Last.fm's own message, never the request URL or key.
 */
export class LastfmApiError extends Error {
  constructor(
    message: string,
    public readonly code: number | null,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'LastfmApiError';
  }
}

type Params = Record<string, string | number>;
type Json = Record<string, unknown>;

interface RawRecentTrack {
  artist?: { name?: string; '#text'?: string };
  album?: { '#text'?: string };
  name?: string;
  date?: { uts?: string };
  '@attr'?: { nowplaying?: string };
}

interface RawNamedCount {
  name?: string;
  playcount?: string | number;
  '@attr'?: { rank?: string | number };
}

/**
 * Text normalisation for keys. A private copy of norm() in packages/services/insights/src/text.ts:
 * NFKC, lower-case, U+2010 hyphen to ASCII hyphen, collapse whitespace, trim. Keep the two identical;
 * both test suites assert the same examples.
 */
function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/‐/g, '-').replace(/\s+/g, ' ').trim();
}

/** Last.fm returns a lone item as an object rather than a one-element array. */
function asList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') return [value as T];
  return [];
}

function toInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function obj(value: unknown): Json {
  return isObject(value) ? value : {};
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Thin, uncached Last.fm client bound to one user. Structurally satisfies LastfmHistoryClient in @listentomore/insights. */
export class LastfmHistory {
  constructor(private readonly config: HistoryConfig) {}

  /** One page of scrobbles in [from, to], ascending by time, without the now-playing row. */
  async getRecentTracksPage(from: number, to: number, page: number): Promise<{ tracks: HistoryScrobble[]; totalPages: number }> {
    const data = await this.call({
      method: 'user.getrecenttracks',
      user: this.config.username,
      from,
      to,
      limit: RECENT_TRACKS_LIMIT,
      extended: 1,
      page,
    }, 'recenttracks');
    const recent = obj(data.recenttracks);
    const tracks: HistoryScrobble[] = [];
    for (const t of asList<RawRecentTrack>(recent.track)) {
      const ts = toInt(t.date?.uts);
      if (t['@attr']?.nowplaying === 'true' || ts === null) continue;
      tracks.push({
        artist: t.artist?.name ?? t.artist?.['#text'] ?? '',
        album: t.album?.['#text'] ?? '',
        track: t.name ?? '',
        ts,
      });
    }
    tracks.sort((a, b) => a.ts - b.ts);
    return { tracks, totalPages: toInt(obj(recent['@attr']).totalPages) ?? 0 };
  }

  /** The user's weekly chart boundaries, as epoch seconds. */
  async getWeeklyChartList(): Promise<Array<{ from: number; to: number }>> {
    const data = await this.call({ method: 'user.getweeklychartlist', user: this.config.username }, 'weeklychartlist');
    const weeks: Array<{ from: number; to: number }> = [];
    for (const c of asList<{ from?: string; to?: string }>(obj(data.weeklychartlist).chart)) {
      const from = toInt(c.from);
      const to = toInt(c.to);
      if (from !== null && to !== null) weeks.push({ from, to });
    }
    return weeks;
  }

  /** Plays per artist for one chart week, keyed by norm(name); entries that normalise alike are summed. */
  async getWeeklyArtistChart(from: number, to: number): Promise<Record<string, number>> {
    const data = await this.call({
      method: 'user.getweeklyartistchart',
      user: this.config.username,
      from,
      to,
      limit: CHART_LIMIT,
    }, 'weeklyartistchart');
    const counts: Record<string, number> = {};
    for (const a of asList<RawNamedCount>(obj(data.weeklyartistchart).artist)) {
      const key = norm(a.name ?? '');
      if (!key) continue;
      counts[key] = (counts[key] ?? 0) + (toInt(a.playcount) ?? 0);
    }
    return counts;
  }

  /** One page of the user's top artists for a period, with 1-based overall ranks. */
  async getTopArtistsPage(
    period: HistoryPeriod,
    page: number,
  ): Promise<{ artists: Array<{ name: string; playcount: number; rank: number }>; totalPages: number }> {
    const data = await this.call({
      method: 'user.gettopartists',
      user: this.config.username,
      period,
      limit: TOP_ARTISTS_LIMIT,
      page,
    }, 'topartists');
    const top = obj(data.topartists);
    const artists = asList<RawNamedCount>(top.artist).map((a, i) => ({
      name: a.name ?? '',
      playcount: toInt(a.playcount) ?? 0,
      rank: toInt(a['@attr']?.rank) ?? (page - 1) * TOP_ARTISTS_LIMIT + i + 1,
    }));
    return { artists, totalPages: toInt(obj(top['@attr']).totalPages) ?? 0 };
  }

  /** The user's lifetime plays of an artist name as given; null when Last.fm has no count or no such artist. */
  async getUserArtistPlaycount(artist: string): Promise<number | null> {
    const data = await this.callOrNotFound({
      method: 'artist.getinfo',
      artist,
      username: this.config.username,
      autocorrect: 0,
    });
    if (!data) return null;
    return toInt(obj(obj(data.artist).stats).userplaycount);
  }

  /** The album's tracklist in Last.fm order and the user's plays of it; nulls for what Last.fm lacks. */
  async getAlbumInfo(artist: string, album: string): Promise<{ tracklist: string[] | null; userPlaycount: number | null }> {
    const data = await this.callOrNotFound({
      method: 'album.getinfo',
      artist,
      album,
      username: this.config.username,
      autocorrect: 0,
    }, 'album');
    if (!data) return { tracklist: null, userPlaycount: null };
    const info = obj(data.album);
    const names = asList<{ name?: string }>(obj(info.tracks).track)
      .map((t) => t.name ?? '')
      .filter(Boolean);
    return { tracklist: names.length > 0 ? names : null, userPlaycount: toInt(info.userplaycount) };
  }

  /** The artist's top tag names in Last.fm's order; empty for an unknown artist. */
  async getArtistTopTags(artist: string): Promise<string[]> {
    const data = await this.callOrNotFound({ method: 'artist.gettoptags', artist, autocorrect: 0 }, 'toptags');
    if (!data) return [];
    return asList<{ name?: string }>(obj(data.toptags).tag)
      .map((t) => t.name ?? '')
      .filter(Boolean);
  }

  /** Like call(), but an unknown entity (error 6) resolves to null instead of throwing. A missing `root` still throws. */
  private async callOrNotFound(params: Params, root?: string): Promise<Json | null> {
    try {
      return await this.call(params, root);
    } catch (error) {
      if (error instanceof LastfmApiError && error.code === ERROR_NOT_FOUND) return null;
      throw error;
    }
  }

  /**
   * One Last.fm GET. Retries a rate limit (error 29 or HTTP 429) after each of RETRY_DELAYS_MS.
   * With `root`, a body without that object fails rather than parsing as an empty result: the insights
   * collector caches completed days and chart weeks for 40 days, so an empty misread would stick.
   */
  private async call(params: Params, root?: string): Promise<Json> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request(params, root);
      } catch (error) {
        const limited = error instanceof LastfmApiError && (error.code === ERROR_RATE_LIMIT || error.status === 429);
        if (!limited || attempt >= RETRY_DELAYS_MS.length) throw error;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  /** A single attempt. The body is parsed before `response.ok`, since Last.fm reports errors on 200 and 400 alike. */
  private async request(params: Params, root?: string): Promise<Json> {
    const query = new URLSearchParams({ api_key: this.config.apiKey, format: 'json' });
    for (const [key, value] of Object.entries(params)) query.set(key, String(value));
    const response = await fetchWithTimeout(`${LASTFM_API_BASE}?${query}`, { timeout: 'fast' });

    let body: Json | null = null;
    try {
      body = obj(JSON.parse(await response.text()));
    } catch {
      body = null;
    }

    const method = String(params.method);
    const code = toInt(body?.error);
    if (code !== null) {
      const detail = typeof body?.message === 'string' ? `: ${body.message}` : '';
      throw new LastfmApiError(`Last.fm ${method} failed with error ${code}${detail}`, code, response.status);
    }
    if (!response.ok || body === null) {
      throw new LastfmApiError(`Last.fm ${method} failed with status ${response.status}`, null, response.status);
    }
    if (root !== undefined && !isObject(body[root])) {
      throw new LastfmApiError(`Last.fm ${method} returned no ${root}`, null, response.status);
    }
    return body;
  }
}
