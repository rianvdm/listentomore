// Types for track and listening data

export interface RecentTrack {
  name: string;
  artist: string;
  album: string;
  image: string | null;
  url: string;
  nowPlaying: boolean;
  playedAt: string | null;
}

export interface TopArtist {
  name: string;
  playcount: number;
  image: string | null;
  url: string;
}

export interface TopAlbum {
  name: string;
  artist: string;
  playcount: number;
  image: string | null;
  url: string;
}

export interface LovedTrack {
  name: string;
  artist: string;
  url: string;
  lovedAt: string;
  image: string | null;
}

export interface ListeningStats {
  recentTracks: RecentTrack[];
  topArtists: TopArtist[];
  topAlbums: TopAlbum[];
  totalScrobbles: number;
}
