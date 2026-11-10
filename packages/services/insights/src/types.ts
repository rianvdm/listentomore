// ABOUTME: Shared types for the insights pipeline - Last.fm inputs, ranked facts and the WeekFacts object.
// ABOUTME: Keep runtime imports to norm only; other modules contribute types here with `import type`.

import { norm } from './text';
import type { ArtistWeek } from './history';
import type { AlbumRun } from './runs';

export interface Scrobble { artist: string; album: string; track: string; ts: number }
export interface CountList { fetchedAt: number; complete: boolean; counts: Record<string, number> } // key: norm(artist)
export interface AlbumInfo { tracklist: string[] | null; userPlaycount: number | null; fetchedAt: number }
export interface WeekInputs {
  username: string;
  timezone: string | null;            // IANA or null
  now: number;                        // T, epoch seconds
  scrobbles: Scrobble[];              // raw, ascending ts, within [now - 35 d, now)
  historyComplete: boolean;           // false when the history page cap was hit
  currentWeekTruncated: boolean;      // true when the 15-page cap was hit
  chartWeeks: Array<{ from: number; to: number; counts: Record<string, number> }>; // up to 8, all older than now - 35 d
  period: { m3: CountList; m6: CountList; m12: CountList };
  overall: CountList & { ranks: Record<string, number> };
  artistLifetime: Record<string, { count: number; fetchedAt: number }>; // key: exact artist name
  albums: Record<string, AlbumInfo>;  // key: albumKey(artist, album)
  tags: Record<string, string[]>;     // key: exact artist name; raw Last.fm order
}
export type Tier = 'first_under_this_name' | 'barely_known' | 'lapsed' | 'all_time_favourite' | 'regular' | 'occasional' | 'unknown';
export type FactKind = 'discovery' | 'repeat_album' | 'volume_vs_normal' | 'volume_spread' | 'genre_cluster' | 'returns'
  | 'breadth' | 'single_listen' | 'album_chain' | 'album_mode' | 'last_week_faded' | 'themed_block' | 'volume';
export type Unit = 'plays' | 'tracks' | 'times' | 'days' | 'months' | 'percent' | 'artists' | 'albums' | 'weeks';
export interface Quantity { value: number; unit: Unit; entity?: string }
export type QuestionKind = 'after' | 'where_from' | 'started' | 'one_sitting';
export interface QuestionOption { kind: QuestionKind; text: string }
export interface Fact {
  id: number;                 // 1-based rank, assigned in rank.ts; 0 is the window line
  kind: FactKind;
  salience: number;           // 0..100
  subject: string | null;     // artist name, tag, or null
  statement: string;          // the sentence the model reads
  entities: string[];         // every artist and album name in the statement
  quantities: Quantity[];     // every number in the statement
  dates: number[];            // epoch seconds of every day or time the statement names
  edges: QuestionOption[];
}
/** A fact before ranking; rank.ts assigns `id`. */
export type Draft = Omit<Fact, 'id'>;
/** Everything the fact rules read for one week. */
export interface FactContext {
  inputs: WeekInputs;
  artists: Map<string, ArtistWeek>;   // this week's artists, keyed by exact name
  runs: AlbumRun[];                   // this week's album runs, graded
  week: Scrobble[];                   // this week, deduped, ascending ts
  rawWeeks: Scrobble[][];             // [this week, 1 week back, ... 4 weeks back], raw
  weeks: Scrobble[][];                // the same weeks, deduped
  baseline: 'full' | 'partial' | 'none';
}
export interface WeekFacts {
  schema: 'week-facts/v1';
  ruleVersion: string;        // RULE_VERSION
  username: string;
  timezone: string | null;
  window: { from: number; to: number };
  pulledAt: number;
  plays: { deduped: number; raw: number; duplicatesRemoved: number };
  priorAverage: number | null;         // mean deduped plays of the 4 prior weeks, null without baseline
  baseline: 'full' | 'partial' | 'none';
  windowFact: Fact;                    // id 0
  facts: Fact[];                       // ranked, ids 1..n
  topArtists: Array<{ artist: string; plays: number; tier: Tier; nameUncertain: boolean }>;
  caveats: string[];
  quiet: boolean;
  question: (QuestionOption & { subject: string }) | null;
  names: string[];                     // every artist and album name in the week's scrobbles
}
export interface LastfmHistoryClient {
  getRecentTracksPage(from: number, to: number, page: number): Promise<{ tracks: Scrobble[]; totalPages: number }>;
  getWeeklyChartList(): Promise<Array<{ from: number; to: number }>>;
  getWeeklyArtistChart(from: number, to: number): Promise<Record<string, number>>;
  getTopArtistsPage(period: '3month' | '6month' | '12month' | 'overall', page: number):
    Promise<{ artists: Array<{ name: string; playcount: number; rank: number }>; totalPages: number }>;
  getUserArtistPlaycount(artist: string): Promise<number | null>;
  getAlbumInfo(artist: string, album: string): Promise<{ tracklist: string[] | null; userPlaycount: number | null }>;
  getArtistTopTags(artist: string): Promise<string[]>;
}
export const RULE_VERSION = 'r1';
export const albumKey = (artist: string, album: string): string => `${norm(artist)}\u0000${norm(album)}`;
