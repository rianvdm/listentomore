// Last.fm service - consolidated API client for Last.fm

import { RecentTracks } from './recent-tracks';
import { TopAlbums, type TimePeriod } from './top-albums';
import { TopArtists } from './top-artists';
import { ArtistDetails } from './artist-detail';
import { LovedTracks } from './loved-tracks';

export { RecentTracks } from './recent-tracks';
export type { RecentTrack } from './recent-tracks';

export { TopAlbums } from './top-albums';
export type { TopAlbum, TimePeriod } from './top-albums';

export { TopArtists } from './top-artists';
export type { TopArtist } from './top-artists';

export { ArtistDetails } from './artist-detail';
export type { ArtistDetail } from './artist-detail';

export { LovedTracks } from './loved-tracks';
export type { LovedTrack } from './loved-tracks';

export interface LastfmConfig {
  apiKey: string;
  username: string;
}

// Convenience class that combines all Last.fm functionality
export class LastfmService {
  public readonly recentTracks: RecentTracks;
  public readonly topAlbums: TopAlbums;
  public readonly topArtists: TopArtists;
  public readonly artistDetails: ArtistDetails;
  public readonly lovedTracks: LovedTracks;

  constructor(config: LastfmConfig) {
    this.recentTracks = new RecentTracks(config);
    this.topAlbums = new TopAlbums(config);
    this.topArtists = new TopArtists(config);
    this.artistDetails = new ArtistDetails(config);
    this.lovedTracks = new LovedTracks(config);
  }

  // Convenience methods
  async getMostRecentTrack() {
    return this.recentTracks.getMostRecentTrack();
  }

  async getCurrentlyPlaying() {
    return this.recentTracks.getCurrentlyPlaying();
  }

  async getTopAlbums(period: TimePeriod = '1month', limit: number = 6) {
    return this.topAlbums.getTopAlbums(period, limit);
  }

  async getTopArtists(period: TimePeriod = '7day', limit: number = 6) {
    return this.topArtists.getTopArtists(period, limit);
  }

  async getArtistDetail(artistName: string) {
    return this.artistDetails.getArtistDetail(artistName);
  }

  async getLovedTracks(limit: number = 10) {
    return this.lovedTracks.getLovedTracks(limit);
  }
}
