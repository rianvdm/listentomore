// ABOUTME: MusicBrainz service for ISRC/UPC enrichment.
// ABOUTME: Provides album UPC and track ISRC lookups to replace Spotify external_ids.

import { lookupAlbumUpc } from './release-lookup';
import { lookupTrackIsrc } from './recording-lookup';
import type { MusicBrainzRateLimiter } from './rate-limit';

export type { MusicBrainzRelease, MusicBrainzRecording } from './types';
export { MusicBrainzRateLimitError } from './errors';
export { reserveSlot, MUSICBRAINZ_INTERVAL_MS, MUSICBRAINZ_MAX_WAIT_MS } from './rate-limit';
export type { MusicBrainzRateLimiter, SlotReservation } from './rate-limit';

export class MusicBrainzService {
  constructor(private cache: KVNamespace, private limiter: MusicBrainzRateLimiter) {}

  /**
   * Look up the UPC (barcode) for an album.
   *
   * Searches MusicBrainz for releases matching the artist and album name,
   * then extracts the barcode. Results are cached for 30 days.
   *
   * @param artist - Primary artist name
   * @param album - Album name
   * @returns UPC string or null if not found
   */
  async getAlbumUpc(artist: string, album: string): Promise<string | null> {
    if (!artist || !album) {
      console.log('[MusicBrainz] Missing artist or album for UPC lookup');
      return null;
    }
    return lookupAlbumUpc(artist, album, this.cache, this.limiter);
  }

  /**
   * Look up the ISRC for a track.
   *
   * Searches MusicBrainz for recordings matching the artist and track name,
   * then retrieves ISRCs. Results are cached for 30 days.
   *
   * @param artist - Primary artist name
   * @param track - Track name
   * @returns ISRC string or null if not found
   */
  async getTrackIsrc(artist: string, track: string): Promise<string | null> {
    if (!artist || !track) {
      console.log('[MusicBrainz] Missing artist or track for ISRC lookup');
      return null;
    }
    return lookupTrackIsrc(artist, track, this.cache, this.limiter);
  }
}
