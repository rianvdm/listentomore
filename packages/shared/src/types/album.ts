// Types for album data across the application

export interface Album {
  id: string; // Spotify ID
  name: string;
  artist: string;
  artistId: string;
  image: string | null;
  releaseDate: string | null;
  url: string;
  genres: string[];
}

export interface AlbumDetail extends Album {
  tracks: Track[];
  summary: string | null;
  citations: string[];
  streamingLinks: StreamingLinks;
}

export interface Track {
  id: string;
  name: string;
  trackNumber: number;
  durationMs: number;
  previewUrl: string | null;
}

export interface StreamingLinks {
  spotify: string | null;
  appleMusic: string | null;
  youtube: string | null;
  songLink: string | null;
}
