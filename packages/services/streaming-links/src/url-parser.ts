// URL parsing utilities for streaming service links
// Extracts platform, content type, and ID from streaming URLs

export type StreamingPlatform = 'spotify' | 'apple-music' | 'unknown';
export type ContentType = 'track' | 'album' | 'artist' | 'unknown';

export interface ParsedUrl {
  platform: StreamingPlatform;
  contentType: ContentType;
  id: string | null;
  originalUrl: string;
}

/**
 * Parse any streaming URL and extract platform/type/ID
 */
export function parseStreamingUrl(url: string): ParsedUrl {
  const normalized = url.trim();

  // Try Spotify first
  const spotifyResult = parseSpotifyUrl(normalized);
  if (spotifyResult) {
    return {
      platform: 'spotify',
      contentType: spotifyResult.type,
      id: spotifyResult.id,
      originalUrl: normalized,
    };
  }

  // Try Apple Music
  const appleResult = parseAppleMusicUrl(normalized);
  if (appleResult) {
    return {
      platform: 'apple-music',
      contentType: appleResult.type,
      id: appleResult.id,
      originalUrl: normalized,
    };
  }

  return {
    platform: 'unknown',
    contentType: 'unknown',
    id: null,
    originalUrl: normalized,
  };
}

/**
 * Parse Spotify URL or URI
 * Formats:
 * - https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh
 * - https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv
 * - https://open.spotify.com/artist/0k17h0D3J5VfsdmQ1iZtE9
 * - spotify:track:4iV5W9uYEdYUVa79Axb7Rh
 * - spotify:album:4LH4d3cOWNNsVw41Gqt2kv
 */
export function parseSpotifyUrl(url: string): { type: ContentType; id: string } | null {
  // Handle spotify: URI format
  const uriMatch = url.match(/^spotify:(track|album|artist):([a-zA-Z0-9]+)$/);
  if (uriMatch) {
    return {
      type: uriMatch[1] as ContentType,
      id: uriMatch[2],
    };
  }

  // Handle open.spotify.com URL format
  const urlMatch = url.match(/open\.spotify\.com\/(track|album|artist)\/([a-zA-Z0-9]+)/);
  if (urlMatch) {
    return {
      type: urlMatch[1] as ContentType,
      id: urlMatch[2],
    };
  }

  return null;
}

/**
 * Parse Apple Music URL
 * Formats:
 * - https://music.apple.com/us/album/album-name/1234567890
 * - https://music.apple.com/us/album/album-name/1234567890?i=9876543210 (track on album)
 * - https://music.apple.com/album/album-name/1234567890 (geo-agnostic)
 * - https://music.apple.com/us/song/song-name/1234567890
 *
 * Note: Apple Music IDs are numeric
 */
export function parseAppleMusicUrl(url: string): { type: ContentType; id: string } | null {
  // Check if it's an Apple Music URL
  if (!url.includes('music.apple.com')) {
    return null;
  }

  // Track within album: /album/name/albumId?i=trackId
  const trackInAlbumMatch = url.match(/music\.apple\.com(?:\/[a-z]{2})?\/album\/[^/]+\/(\d+)\?i=(\d+)/);
  if (trackInAlbumMatch) {
    return {
      type: 'track',
      id: trackInAlbumMatch[2], // Return the track ID (i= param)
    };
  }

  // Standalone song: /song/name/id
  const songMatch = url.match(/music\.apple\.com(?:\/[a-z]{2})?\/song\/[^/]+\/(\d+)/);
  if (songMatch) {
    return {
      type: 'track',
      id: songMatch[1],
    };
  }

  // Album: /album/name/id (without ?i= param)
  const albumMatch = url.match(/music\.apple\.com(?:\/[a-z]{2})?\/album\/[^/]+\/(\d+)(?:\?|$)/);
  if (albumMatch) {
    return {
      type: 'album',
      id: albumMatch[1],
    };
  }

  // Artist: /artist/name/id
  const artistMatch = url.match(/music\.apple\.com(?:\/[a-z]{2})?\/artist\/[^/]+\/(\d+)/);
  if (artistMatch) {
    return {
      type: 'artist',
      id: artistMatch[1],
    };
  }

  return null;
}

/**
 * Check if a URL is from a supported streaming platform
 */
export function isSupportedUrl(url: string): boolean {
  const parsed = parseStreamingUrl(url);
  return parsed.platform !== 'unknown' && parsed.id !== null;
}

/**
 * Build a Spotify URL from type and ID
 */
export function buildSpotifyUrl(type: ContentType, id: string): string {
  return `https://open.spotify.com/${type}/${id}`;
}

/**
 * Build an Apple Music URL from type and ID (geo-agnostic)
 */
export function buildAppleMusicUrl(type: ContentType, id: string): string {
  // Apple Music URLs need a name segment, but we can use a placeholder
  // The ID is what matters for resolution
  const typeSegment = type === 'track' ? 'song' : type;
  return `https://music.apple.com/${typeSegment}/-/${id}`;
}
