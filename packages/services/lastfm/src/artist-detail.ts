// Last.fm artist detail functionality

const LASTFM_API_BASE = 'https://ws.audioscrobbler.com/2.0';

export interface ArtistDetail {
  name: string;
  url: string;
  image: string | null;
  userPlaycount: number;
  tags: string[];
  similar: string[];
  bio: string;
}

interface LastfmArtistInfoResponse {
  artist: {
    name: string;
    url: string;
    image: Array<{ '#text': string; size: string }>;
    stats?: {
      userplaycount: string;
    };
    tags?: {
      tag: Array<{ name: string }>;
    };
    similar?: {
      artist: Array<{ name: string }>;
    };
    bio?: {
      content: string;
    };
  };
  error?: number;
  message?: string;
}

export interface LastfmConfig {
  apiKey: string;
  username: string;
}

export class ArtistDetails {
  constructor(private config: LastfmConfig) {}

  async getArtistDetail(artistName: string): Promise<ArtistDetail> {
    const url = `${LASTFM_API_BASE}/?method=artist.getInfo&artist=${encodeURIComponent(artistName)}&username=${encodeURIComponent(this.config.username)}&api_key=${encodeURIComponent(this.config.apiKey)}&format=json&autocorrect=1`;

    const response = await fetch(url);
    const data = (await response.json()) as LastfmArtistInfoResponse;

    if (data.error) {
      throw new Error(data.message || `Failed to fetch artist: ${artistName}`);
    }

    const artist = data.artist;

    // Filter tags: remove "seen live" and any tag with numbers
    const filteredTags = Array.isArray(artist.tags?.tag)
      ? artist.tags.tag
          .filter((tag) => tag.name.toLowerCase() !== 'seen live' && !/\d/.test(tag.name))
          .slice(0, 3)
          .map((tag) => tag.name.charAt(0).toUpperCase() + tag.name.slice(1))
      : [];

    return {
      name: artist.name,
      url: artist.url,
      image: artist.image?.find((img) => img.size === 'extralarge')?.['#text'] || null,
      userPlaycount: parseInt(artist.stats?.userplaycount || '0', 10),
      tags: filteredTags,
      similar: artist.similar?.artist?.slice(0, 3).map((a) => a.name) || [],
      bio: artist.bio?.content || '',
    };
  }
}
