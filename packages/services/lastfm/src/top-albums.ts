// Last.fm top albums functionality

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0';
const BACKUP_IMAGE_URL = 'https://file.elezea.com/noun-no-image.png';

export type TimePeriod = '7day' | '1month' | '3month' | '6month' | '12month' | 'overall';

export interface TopAlbum {
  artist: string;
  artistUrl: string;
  name: string;
  playcount: number;
  albumUrl: string;
  image: string;
}

interface LastfmTopAlbumsResponse {
  topalbums: {
    album: Array<{
      artist: { name: string; url: string };
      name: string;
      playcount: string;
      url: string;
      image: Array<{ '#text': string; size: string }>;
    }>;
  };
}

export interface LastfmConfig {
  apiKey: string;
  username: string;
}

export class TopAlbums {
  constructor(private config: LastfmConfig) {}

  async getTopAlbums(period: TimePeriod = '1month', limit: number = 6): Promise<TopAlbum[]> {
    const url = `${LASTFM_API_BASE}/?method=user.gettopalbums&user=${encodeURIComponent(this.config.username)}&api_key=${encodeURIComponent(this.config.apiKey)}&period=${period}&limit=${limit}&format=json`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Last.fm API responded with status ${response.status}`);
    }

    const data = (await response.json()) as LastfmTopAlbumsResponse;
    const albums = data.topalbums?.album || [];

    return albums.map((album) => ({
      artist: album.artist.name,
      artistUrl: album.artist.url,
      name: album.name,
      playcount: parseInt(album.playcount, 10),
      albumUrl: album.url,
      image: album.image?.find((img) => img.size === 'extralarge')?.['#text'] || BACKUP_IMAGE_URL,
    }));
  }
}
