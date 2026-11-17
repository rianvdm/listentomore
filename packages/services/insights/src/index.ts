// ABOUTME: Public entry point for @listentomore/insights - turns Last.fm data into ranked week facts.
// ABOUTME: Re-exports the shared types and the pure helpers each stage of the pipeline uses.

export * from './types';
export { norm } from './text';
export { weekWindow, utcDays, dayLabel, timeLabel, localHour, localDate, tsOnLocalDate } from './window';
export { hasEditionMarker, matchKey, stripEdition } from './match';
export { dedupe } from './dedupe';
export { artistWeeks, isNameUncertain } from './history';
export type { ArtistWeek } from './history';
export { albumRuns, albumChains, albumModeShare, runsToLookUp } from './runs';
export type { AlbumRun, RunToLookUp, Verdict } from './runs';
export { artistFacts } from './facts-artist';
export { albumFacts } from './facts-album';
export { weekFacts } from './facts-week';
export { releaseWeekFacts } from './facts-release';
export { BROAD_TAGS, BUCKETS, BUCKET_LABELS, NOISE_TAGS, STOP_TAGS, bucketOf, cleanTags } from './tags';
export { QUIET_THRESHOLD, rankFacts } from './rank';
export { DUPLICATES_CAVEAT, TRUNCATED_CAVEAT, buildWeekFacts } from './build';
export { PROMPT_FACTS, noteSignature, renderLine, renderPromptView } from './render';
export { checkNote } from './check';
export type { NoteCheckFailure } from './check';
export { keyFamily, keys, userExactKeys, userKeyPrefixes } from './keys';
export { CAPS, InsightsFetchError, collectReleases, collectWeekInputs } from './collect';
export type { Caps, CollectArgs } from './collect';
