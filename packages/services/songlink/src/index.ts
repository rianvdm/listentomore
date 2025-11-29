// Songlink service - get streaming links for songs and albums

import { CACHE_CONFIG } from '@listentomore/config';

const SONGLINK_API_BASE = 'https://api.song.link/v1-alpha.1/links';

export type MediaType = 'song' | 'album' | 'unknown';

export interface StreamingLinks {
  pageUrl: string;
  appleUrl: string | null;
  youtubeUrl: string | null;
  deezerUrl: string | null;
  spotifyUrl: string | null;
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
    deezer?: { url: string };
    spotify?: { url: string };
  };
}

export class SonglinkService {
  constructor(private cache: KVNamespace) {}

  async getLinks(streamingUrl: string): Promise<StreamingLinks> {
    const cacheKey = `songlink:${streamingUrl}`;

    // Check cache
    const cached = await this.cache.get<StreamingLinks>(cacheKey, 'json');
    if (cached) {
      return cached;
    }

    const encodedUrl = encodeURIComponent(streamingUrl);
    const response = await fetch(`${SONGLINK_API_BASE}?url=${encodedUrl}`);

    if (!response.ok) {
      throw new Error(`Songlink API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as SonglinkResponse;

    const entity = data.entitiesByUniqueId[data.entityUniqueId];

    const links: StreamingLinks = {
      pageUrl: data.pageUrl,
      appleUrl: data.linksByPlatform?.appleMusic?.url || null,
      youtubeUrl: data.linksByPlatform?.youtube?.url || null,
      deezerUrl: data.linksByPlatform?.deezer?.url || null,
      spotifyUrl: data.linksByPlatform?.spotify?.url || null,
      artistName: entity?.artistName || 'Unknown Artist',
      title: entity?.title || 'Unknown Title',
      thumbnailUrl: entity?.thumbnailUrl || null,
      type: (entity?.type as MediaType) || 'unknown',
    };

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
