// Discogs collection fetching and normalization

import { DiscogsClient } from './client';
import type {
  DiscogsConfig,
  DiscogsCollectionResponse,
  DiscogsCollectionRelease,
  DiscogsMasterRelease,
  DiscogsIdentity,
  NormalizedRelease,
  CollectionStats,
} from './types';
import { CACHE_CONFIG, getTtlSeconds } from '@listentomore/config';

export class DiscogsCollection {
  private client: DiscogsClient;
  private cache?: KVNamespace;
  private username?: string;

  constructor(config: DiscogsConfig) {
    this.client = new DiscogsClient(config);
    this.cache = config.cache;
  }

  /**
   * Get the authenticated user's identity (username, id)
   */
  async getIdentity(): Promise<DiscogsIdentity> {
    return this.client.request<DiscogsIdentity>('/oauth/identity');
  }

  /**
   * Set the username for collection operations
   */
  setUsername(username: string): void {
    this.username = username;
  }

  /**
   * Get the username, fetching from identity if not set
   */
  async getUsername(): Promise<string> {
    if (this.username) {
      return this.username;
    }
    const identity = await this.getIdentity();
    this.username = identity.username;
    return this.username;
  }

  /**
   * Fetch a single page of the user's collection
   */
  async getCollectionPage(
    page: number = 1,
    perPage: number = 100
  ): Promise<DiscogsCollectionResponse> {
    const username = await this.getUsername();
    return this.client.request<DiscogsCollectionResponse>(
      `/users/${username}/collection/folders/0/releases`,
      {
        params: {
          page,
          per_page: perPage,
          sort: 'added',
          sort_order: 'desc',
        },
      }
    );
  }

  /**
   * Fetch all releases in the user's collection (paginated)
   * Returns normalized releases for easier consumption
   */
  async getAllReleases(
    onProgress?: (current: number, total: number) => void
  ): Promise<NormalizedRelease[]> {
    const allReleases: NormalizedRelease[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const response = await this.getCollectionPage(page, 100);
      totalPages = response.pagination.pages;

      const normalized = response.releases.map((r) => this.normalizeRelease(r));
      allReleases.push(...normalized);

      if (onProgress) {
        onProgress(page, totalPages);
      }

      page++;

      // Small delay between pages to be nice to the API
      if (page <= totalPages) {
        await this.sleep(500);
      }
    } while (page <= totalPages);

    return allReleases;
  }

  /**
   * Fetch master release data for enrichment
   */
  async getMasterRelease(masterId: number): Promise<DiscogsMasterRelease | null> {
    // Check cache first
    if (this.cache) {
      const cacheKey = `discogs:master:${masterId}`;
      const cached = await this.cache.get(cacheKey, 'json');
      if (cached) {
        return cached as DiscogsMasterRelease;
      }
    }

    try {
      const master = await this.client.request<DiscogsMasterRelease>(
        `/masters/${masterId}`
      );

      // Cache the result
      if (this.cache) {
        const cacheKey = `discogs:master:${masterId}`;
        await this.cache.put(cacheKey, JSON.stringify(master), {
          expirationTtl: getTtlSeconds(CACHE_CONFIG.discogs.master),
        });
      }

      return master;
    } catch (error) {
      console.error(`Failed to fetch master release ${masterId}:`, error);
      return null;
    }
  }

  /**
   * Normalize a Discogs collection release to our internal format
   */
  normalizeRelease(release: DiscogsCollectionRelease): NormalizedRelease {
    const info = release.basic_information;
    const primaryArtist = info.artists[0];
    const primaryFormat = info.formats[0];
    const primaryLabel = info.labels[0];

    // Build artist name (handle "Various" and multiple artists)
    let artistName = primaryArtist?.name || 'Unknown Artist';
    if (info.artists.length > 1) {
      artistName = info.artists.map((a) => a.name).join(', ');
    }
    // Clean up artist name (remove trailing numbers like "Artist (2)")
    artistName = artistName.replace(/\s*\(\d+\)$/, '');

    // Build format string
    const formatName = primaryFormat?.name || 'Unknown';
    const formatDetails = primaryFormat?.descriptions || [];

    return {
      id: info.id,
      instanceId: release.instance_id,
      title: info.title,
      artist: artistName,
      artistId: primaryArtist?.id || 0,
      year: info.year || null,
      originalYear: null, // Populated by enrichment
      format: formatName,
      formatDetails,
      label: primaryLabel?.name || 'Unknown',
      catalogNumber: primaryLabel?.catno || '',
      genres: info.genres || [],
      styles: info.styles || [],
      masterGenres: [], // Populated by enrichment
      masterStyles: [], // Populated by enrichment
      imageUrl: info.cover_image || '',
      thumbUrl: info.thumb || '',
      discogsUrl: `https://www.discogs.com/release/${info.id}`,
      dateAdded: release.date_added,
      rating: release.rating,
      masterId: info.master_id || null,
      masterEnriched: false,
    };
  }

  /**
   * Calculate collection statistics from releases
   */
  calculateStats(releases: NormalizedRelease[]): CollectionStats {
    const genreCounts: Record<string, number> = {};
    const formatCounts: Record<string, number> = {};
    const decadeCounts: Record<string, number> = {};
    const artistCounts: Record<string, number> = {};
    const uniqueGenres = new Set<string>();
    const uniqueFormats = new Set<string>();
    const uniqueStyles = new Set<string>();
    const years: number[] = [];

    for (const release of releases) {
      // Genres (prefer master genres if available)
      const genres = release.masterGenres.length > 0 ? release.masterGenres : release.genres;
      for (const genre of genres) {
        uniqueGenres.add(genre);
        genreCounts[genre] = (genreCounts[genre] || 0) + 1;
      }

      // Styles
      const styles = release.masterStyles.length > 0 ? release.masterStyles : release.styles;
      for (const style of styles) {
        uniqueStyles.add(style);
      }

      // Formats
      uniqueFormats.add(release.format);
      formatCounts[release.format] = (formatCounts[release.format] || 0) + 1;

      // Years and decades
      const year = release.originalYear || release.year;
      if (year && year > 1900) {
        years.push(year);
        const decade = `${Math.floor(year / 10) * 10}s`;
        decadeCounts[decade] = (decadeCounts[decade] || 0) + 1;
      }

      // Artists
      artistCounts[release.artist] = (artistCounts[release.artist] || 0) + 1;
    }

    return {
      totalItems: releases.length,
      uniqueGenres: Array.from(uniqueGenres).sort(),
      uniqueFormats: Array.from(uniqueFormats).sort(),
      uniqueStyles: Array.from(uniqueStyles).sort(),
      uniqueArtists: Object.keys(artistCounts).length,
      earliestYear: years.length > 0 ? Math.min(...years) : null,
      latestYear: years.length > 0 ? Math.max(...years) : null,
      lastAdded: releases[0]?.dateAdded || null,
      genreCounts,
      formatCounts,
      decadeCounts,
      artistCounts,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
