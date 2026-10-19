// ABOUTME: Per-user "most recent track" cache written by the scheduled handler.
// ABOUTME: Feeds /widget/recent and stands in for a user when Last.fm fails during the cron.

export interface RecentTrackData {
  username: string;
  artist: string;
  album: string;
  track: string;
  image: string | null;
  playedAt: string | null;
  nowPlaying: boolean;
}

export function recentTrackKey(lastfmUsername: string): string {
  return `widget:recent:${lastfmUsername}`;
}

/**
 * Read a user's last saved track. nowPlaying is cleared because the saved
 * copy can be up to 7 days old.
 */
export async function loadCachedRecentTrack(
  cache: KVNamespace,
  lastfmUsername: string
): Promise<RecentTrackData | null> {
  try {
    const saved = await cache.get<RecentTrackData>(recentTrackKey(lastfmUsername), 'json');
    return saved ? { ...saved, nowPlaying: false } : null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[CRON] Failed to read saved recent track:', errorMessage, error);
    return null;
  }
}
