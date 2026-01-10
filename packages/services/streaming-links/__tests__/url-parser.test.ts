// URL parser tests

import { describe, it, expect } from 'vitest';
import {
    parseStreamingUrl,
    parseSpotifyUrl,
    parseAppleMusicUrl,
    isSupportedUrl,
    buildSpotifyUrl,
    buildAppleMusicUrl,
} from '../src/url-parser';

describe('parseSpotifyUrl', () => {
    it('parses track URL', () => {
        const result = parseSpotifyUrl('https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh');
        expect(result).toEqual({ type: 'track', id: '4iV5W9uYEdYUVa79Axb7Rh' });
    });

    it('parses album URL', () => {
        const result = parseSpotifyUrl('https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv');
        expect(result).toEqual({ type: 'album', id: '4LH4d3cOWNNsVw41Gqt2kv' });
    });

    it('parses artist URL', () => {
        const result = parseSpotifyUrl('https://open.spotify.com/artist/0k17h0D3J5VfsdmQ1iZtE9');
        expect(result).toEqual({ type: 'artist', id: '0k17h0D3J5VfsdmQ1iZtE9' });
    });

    it('parses track URI', () => {
        const result = parseSpotifyUrl('spotify:track:4iV5W9uYEdYUVa79Axb7Rh');
        expect(result).toEqual({ type: 'track', id: '4iV5W9uYEdYUVa79Axb7Rh' });
    });

    it('parses album URI', () => {
        const result = parseSpotifyUrl('spotify:album:4LH4d3cOWNNsVw41Gqt2kv');
        expect(result).toEqual({ type: 'album', id: '4LH4d3cOWNNsVw41Gqt2kv' });
    });

    it('returns null for non-Spotify URL', () => {
        expect(parseSpotifyUrl('https://music.apple.com/album/test/123')).toBeNull();
    });
});

describe('parseAppleMusicUrl', () => {
    it('parses album URL with storefront', () => {
        const result = parseAppleMusicUrl('https://music.apple.com/us/album/in-rainbows/1109714933');
        expect(result).toEqual({ type: 'album', id: '1109714933' });
    });

    it('parses album URL without storefront (geo-agnostic)', () => {
        const result = parseAppleMusicUrl('https://music.apple.com/album/in-rainbows/1109714933');
        expect(result).toEqual({ type: 'album', id: '1109714933' });
    });

    it('parses track on album URL (with ?i= param)', () => {
        const result = parseAppleMusicUrl(
            'https://music.apple.com/us/album/reckoner/1109714933?i=1109715066'
        );
        expect(result).toEqual({ type: 'track', id: '1109715066' });
    });

    it('parses standalone song URL', () => {
        const result = parseAppleMusicUrl('https://music.apple.com/us/song/reckoner/1109715066');
        expect(result).toEqual({ type: 'track', id: '1109715066' });
    });

    it('parses artist URL', () => {
        const result = parseAppleMusicUrl('https://music.apple.com/us/artist/radiohead/657515');
        expect(result).toEqual({ type: 'artist', id: '657515' });
    });

    it('returns null for non-Apple Music URL', () => {
        expect(parseAppleMusicUrl('https://open.spotify.com/album/test')).toBeNull();
    });
});

describe('parseStreamingUrl', () => {
    it('identifies Spotify track', () => {
        const result = parseStreamingUrl('https://open.spotify.com/track/abc123');
        expect(result.platform).toBe('spotify');
        expect(result.contentType).toBe('track');
        expect(result.id).toBe('abc123');
    });

    it('identifies Apple Music album', () => {
        const result = parseStreamingUrl('https://music.apple.com/us/album/test/123456');
        expect(result.platform).toBe('apple-music');
        expect(result.contentType).toBe('album');
        expect(result.id).toBe('123456');
    });

    it('returns unknown for unsupported URL', () => {
        const result = parseStreamingUrl('https://youtube.com/watch?v=abc');
        expect(result.platform).toBe('unknown');
        expect(result.contentType).toBe('unknown');
        expect(result.id).toBeNull();
    });

    it('preserves original URL', () => {
        const url = 'https://open.spotify.com/track/abc123';
        const result = parseStreamingUrl(url);
        expect(result.originalUrl).toBe(url);
    });
});

describe('isSupportedUrl', () => {
    it('returns true for Spotify URL', () => {
        expect(isSupportedUrl('https://open.spotify.com/track/abc123')).toBe(true);
    });

    it('returns true for Apple Music URL', () => {
        expect(isSupportedUrl('https://music.apple.com/album/test/123')).toBe(true);
    });

    it('returns false for YouTube URL', () => {
        expect(isSupportedUrl('https://youtube.com/watch?v=abc')).toBe(false);
    });

    it('returns false for random URL', () => {
        expect(isSupportedUrl('https://example.com')).toBe(false);
    });
});

describe('buildSpotifyUrl', () => {
    it('builds track URL', () => {
        expect(buildSpotifyUrl('track', 'abc123')).toBe('https://open.spotify.com/track/abc123');
    });

    it('builds album URL', () => {
        expect(buildSpotifyUrl('album', 'xyz789')).toBe('https://open.spotify.com/album/xyz789');
    });
});

describe('buildAppleMusicUrl', () => {
    it('builds track URL (as song)', () => {
        expect(buildAppleMusicUrl('track', '123456')).toBe('https://music.apple.com/song/-/123456');
    });

    it('builds album URL', () => {
        expect(buildAppleMusicUrl('album', '789012')).toBe('https://music.apple.com/album/-/789012');
    });
});
