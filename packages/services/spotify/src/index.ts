// ABOUTME: Spotify service - consolidated API client for Spotify.
// ABOUTME: Wires auth, rate limiting, and deferred cache writes into the album/artist/search clients.

import { SpotifyAuth } from './auth';
import { SpotifySearch } from './search';
import { SpotifyAlbums } from './albums';
import { SpotifyArtists } from './artists';
import { SpotifyRateLimiter } from './rate-limit';
import { createDefer } from './defer';
import type { WaitUntil } from './defer';

export { SpotifyAuth } from './auth';
export type { SpotifyAuthConfig, SpotifyTokenData } from './auth';

export { SpotifySearch } from './search';
export type {
  SearchType,
  TrackSearchResult,
  AlbumSearchResult,
  ArtistSearchResult,
  SearchResult,
} from './search';

export { SpotifyAlbums } from './albums';
export type { AlbumDetails, AlbumTrack } from './albums';

export { SpotifyArtists } from './artists';
export type { ArtistDetails } from './artists';

export { SpotifyRateLimiter } from './rate-limit';
export type { RateLimitState } from './rate-limit';

export { createDefer } from './defer';
export type { Defer, WaitUntil } from './defer';

// Convenience class that combines all Spotify functionality
export class SpotifyService {
  public readonly auth: SpotifyAuth;
  public readonly search: SpotifySearch;
  public readonly albums: SpotifyAlbums;
  public readonly artists: SpotifyArtists;
  public readonly rateLimiter: SpotifyRateLimiter;
  /** First 8 chars of client ID for logging/debugging */
  public readonly clientIdPrefix: string;

  constructor(config: {
    clientId: string;
    clientSecret: string;
    cache: KVNamespace;
    /**
     * The request's ctx.waitUntil. Cache writes are never awaited on the response path;
     * passing this keeps them alive after the response is sent or the client disconnects.
     */
    waitUntil?: WaitUntil;
  }) {
    this.clientIdPrefix = config.clientId.substring(0, 8);
    const defer = createDefer(config.waitUntil);

    // Shared rate limiter for all calls made with this app's credentials
    this.rateLimiter = new SpotifyRateLimiter(config.clientId);

    this.auth = new SpotifyAuth(
      {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      },
      config.cache,
      defer
    );

    this.search = new SpotifySearch(this.auth, config.cache, this.rateLimiter, defer);
    this.albums = new SpotifyAlbums(this.auth, config.cache, this.rateLimiter, defer);
    this.artists = new SpotifyArtists(this.auth, config.cache, this.rateLimiter, defer);
  }

  // Convenience methods
  async searchAlbum(query: string) {
    return this.search.searchAlbum(query);
  }

  async searchAlbumByArtist(artist: string, album: string) {
    return this.search.searchAlbumByArtist(artist, album);
  }

  async searchArtist(query: string) {
    return this.search.searchArtist(query);
  }

  async searchTrack(query: string) {
    return this.search.searchTrack(query);
  }

  async getAlbum(id: string) {
    return this.albums.getAlbum(id);
  }

  async getArtist(id: string) {
    return this.artists.getArtist(id);
  }

  async getArtistAlbums(artistId: string, limit?: number) {
    return this.artists.getArtistAlbums(artistId, limit);
  }

  async getRelatedArtists(artistId: string, limit?: number) {
    return this.artists.getRelatedArtists(artistId, limit);
  }
}
