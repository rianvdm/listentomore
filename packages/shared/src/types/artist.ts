// Types for artist data across the application

export interface Artist {
  id: string; // Spotify ID
  name: string;
  image: string | null;
  genres: string[];
  url: string;
}

export interface ArtistDetail extends Artist {
  bio: string | null;
  summary: string | null;
  topAlbums: ArtistAlbum[];
  tags: string[];
  playcount: number | null;
  listeners: number | null;
}

export interface ArtistAlbum {
  name: string;
  image: string | null;
  playcount: number;
  url: string;
}

export interface ArtistSentence {
  artist: string;
  sentence: string;
}
