// Spotify service - consolidated API client for Spotify

import { SpotifyAuth } from './auth';
import { SpotifySearch } from './search';
import { SpotifyAlbums } from './albums';
import { SpotifyArtists } from './artists';

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

// Convenience class that combines all Spotify functionality
export class SpotifyService {
  public readonly auth: SpotifyAuth;
  public readonly search: SpotifySearch;
  public readonly albums: SpotifyAlbums;
  public readonly artists: SpotifyArtists;

  constructor(config: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    cache: KVNamespace;
  }) {
    this.auth = new SpotifyAuth(
      {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken: config.refreshToken,
      },
      config.cache
    );

    this.search = new SpotifySearch(this.auth, config.cache);
    this.albums = new SpotifyAlbums(this.auth, config.cache);
    this.artists = new SpotifyArtists(this.auth, config.cache);
  }

  // Convenience methods
  async searchAlbum(query: string) {
    return this.search.searchAlbum(query);
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
}
