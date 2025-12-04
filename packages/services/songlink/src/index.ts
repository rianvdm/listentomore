// ABOUTME: Songlink service - get streaming links for songs and albums.
// ABOUTME: Aggregates links from multiple streaming platforms via song.link API.

import { CACHE_CONFIG } from '@listentomore/config';
import { fetchWithTimeout } from '@listentomore/shared';

const SONGLINK_API_BASE = 'https://api.song.link/v1-alpha.1/links';

export type MediaType = 'song' | 'album' | 'unknown';

export interface StreamingLinks {
  pageUrl: string;
  appleUrl: string | null;
  youtubeUrl: string | null;
  deezerUrl: string | null;
  spotifyUrl: string | null;
  tidalUrl: string | null;
  artistName: string;
  title: string;
  thumbnailUrl: string | null;
  type: MediaType;
}

interface SonglinkResponse {
  entityUniqueId: string;
  pageUrl: string;
  entitiesByUniqueId: {
    [key: string]: {
      artistName?: string;
      title?: string;
      thumbnailUrl?: string;
      type?: string;
    };
  };
  linksByPlatform?: {
    appleMusic?: { url: string };
    youtube?: { url: string };
    youtubeMusic?: { url: string };
    deezer?: { url: string };
    spotify?: { url: string };
    tidal?: { url: string };
  };
}

export class SonglinkService {
  constructor(private cache: KVNamespace) {}

  async getLinks(streamingUrl: string): Promise<StreamingLinks> {
    const cacheKey = `songlink:${streamingUrl}`;

    // Check cache
    const cached = await this.cache.get<StreamingLinks>(cacheKey, 'json');
    if (cached) {
      console.log(`[Songlink] Cache hit for ${streamingUrl}`);
      return cached;
    }

    const startTime = Date.now();
    console.log(`[Songlink] Fetching ${streamingUrl}`);
    const encodedUrl = encodeURIComponent(streamingUrl);

    let response: Response;
    try {
      response = await fetchWithTimeout(`${SONGLINK_API_BASE}?url=${encodedUrl}`, {
        timeout: 'fast',
      });
    } catch (fetchError) {
      const duration = Date.now() - startTime;
      console.error(`[Songlink] Fetch failed for ${streamingUrl} (${duration}ms):`, fetchError);
      throw fetchError;
    }

    const duration = Date.now() - startTime;
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    const rateLimitReset = response.headers.get('x-ratelimit-reset');

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Songlink] API error ${response.status} for ${streamingUrl} (${duration}ms): ${errorText}${rateLimitRemaining ? ` | Rate limit: ${rateLimitRemaining} remaining` : ''}${rateLimitReset ? `, resets ${rateLimitReset}` : ''}`);

      // On rate limit or other errors, return partial data with just the original URL
      if (response.status === 429 || response.status >= 500) {
        console.log(`[Songlink] Returning partial data due to ${response.status}`);
        return {
          pageUrl: '',
          appleUrl: null,
          youtubeUrl: null,
          deezerUrl: null,
          spotifyUrl: streamingUrl.includes('spotify') ? streamingUrl : null,
          tidalUrl: null,
          artistName: 'Unknown Artist',
          title: 'Unknown Title',
          thumbnailUrl: null,
          type: 'unknown' as MediaType,
        };
      }

      throw new Error(`Songlink API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as SonglinkResponse;

    const entity = data.entitiesByUniqueId?.[data.entityUniqueId];

    // Prefer youtube over youtubeMusic for regular YouTube links
    const youtubeUrl = data.linksByPlatform?.youtube?.url
      || data.linksByPlatform?.youtubeMusic?.url
      || null;

    const links: StreamingLinks = {
      pageUrl: data.pageUrl,
      appleUrl: data.linksByPlatform?.appleMusic?.url || null,
      youtubeUrl,
      deezerUrl: data.linksByPlatform?.deezer?.url || null,
      spotifyUrl: data.linksByPlatform?.spotify?.url || null,
      tidalUrl: data.linksByPlatform?.tidal?.url || null,
      artistName: entity?.artistName || 'Unknown Artist',
      title: entity?.title || 'Unknown Title',
      thumbnailUrl: entity?.thumbnailUrl || null,
      type: (entity?.type as MediaType) || 'unknown',
    };

    // Count platforms found
    const platformCount = [links.appleUrl, links.youtubeUrl, links.deezerUrl, links.spotifyUrl, links.tidalUrl]
      .filter(Boolean).length;
    console.log(`[Songlink] Success for "${links.title}" by ${links.artistName} (${duration}ms) | ${platformCount} platforms${rateLimitRemaining ? ` | Rate limit: ${rateLimitRemaining} remaining` : ''}`);

    // Cache results
    await this.cache.put(cacheKey, JSON.stringify(links), {
      expirationTtl: CACHE_CONFIG.songlink.links.ttlDays * 24 * 60 * 60,
    });

    return links;
  }

  // Convenience method for Spotify URLs
  async getLinksFromSpotify(spotifyUrl: string): Promise<StreamingLinks> {
    if (!spotifyUrl.includes('spotify.com') && !spotifyUrl.startsWith('spotify:')) {
      throw new Error('Invalid Spotify URL');
    }
    return this.getLinks(spotifyUrl);
  }
}
