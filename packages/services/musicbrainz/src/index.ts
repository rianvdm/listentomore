// ABOUTME: MusicBrainz service for ISRC/UPC enrichment.
// ABOUTME: Provides album UPC and track ISRC lookups to replace Spotify external_ids.

import { lookupAlbumUpc } from './release-lookup';
import { lookupTrackIsrc } from './recording-lookup';

export type { MusicBrainzRelease, MusicBrainzRecording } from './types';

export class MusicBrainzService {
  constructor(private cache: KVNamespace) {}

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
    return lookupAlbumUpc(artist, album, this.cache);
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
    return lookupTrackIsrc(artist, track, this.cache);
  }
}
