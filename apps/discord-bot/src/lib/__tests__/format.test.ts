import { describe, expect, it } from 'vitest';
import {
  albumUrl,
  artistUrl,
  capitalizeWords,
  formatStreamingLinks,
  genreUrl,
} from '../format';

describe('capitalizeWords', () => {
  it('capitalizes the first letter of each word', () => {
    expect(capitalizeWords('the dark side of the moon')).toBe('The Dark Side Of The Moon');
  });

  it('leaves already-capitalized words alone', () => {
    expect(capitalizeWords('OK Computer')).toBe('OK Computer');
  });

  it('handles empty strings', () => {
    expect(capitalizeWords('')).toBe('');
  });
});

describe('albumUrl', () => {
  it('builds an album URL from a Spotify ID', () => {
    expect(albumUrl('4aawyAB9vmqN3uQ7FjRGTy')).toBe(
      'https://listentomore.com/album/4aawyAB9vmqN3uQ7FjRGTy'
    );
  });
});

describe('artistUrl', () => {
  it('builds an artist URL from a Spotify ID', () => {
    expect(artistUrl('4Z8W4fKeB5YxbusRsdQVPb')).toBe(
      'https://listentomore.com/artist/4Z8W4fKeB5YxbusRsdQVPb'
    );
  });
});

describe('genreUrl', () => {
  it('lowercases and slugifies a single-word genre', () => {
    expect(genreUrl('Rock')).toBe('https://listentomore.com/genre/rock');
  });

  it('replaces whitespace with hyphens', () => {
    expect(genreUrl('Indie Rock')).toBe('https://listentomore.com/genre/indie-rock');
  });

  it('encodes characters that survive slugification', () => {
    expect(genreUrl('R&B')).toBe('https://listentomore.com/genre/r%26b');
  });
});

describe('formatStreamingLinks', () => {
  it('joins all provided links with bullets', () => {
    const out = formatStreamingLinks({
      pageUrl: 'https://song.link/x',
      spotifyUrl: 'https://spotify.com/x',
      appleUrl: 'https://music.apple.com/x',
      deezerUrl: 'https://deezer.com/x',
    });
    expect(out).toBe(
      '[SongLink](https://song.link/x) • [Spotify](https://spotify.com/x) • [Apple Music](https://music.apple.com/x) • [Deezer](https://deezer.com/x)'
    );
  });

  it('omits missing links', () => {
    const out = formatStreamingLinks({
      spotifyUrl: 'https://spotify.com/x',
      appleUrl: 'https://music.apple.com/x',
    });
    expect(out).toBe('[Spotify](https://spotify.com/x) • [Apple Music](https://music.apple.com/x)');
  });

  it('returns an empty string when all links are missing', () => {
    expect(formatStreamingLinks({})).toBe('');
  });
});
