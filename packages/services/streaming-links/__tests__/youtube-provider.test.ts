// ABOUTME: Tests for YouTubeProvider - how the Data API key is sent on search requests.
// ABOUTME: The key must travel in a header, since outbound fetch traces record the full URL.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { YouTubeProvider } from '../src/index';
import type { TrackMetadata } from '../src/types';

const track: TrackMetadata = {
  type: 'track',
  id: '6LgJvl0Xdtc73RJ1mmpotq',
  isrc: 'GBAYE0601498',
  name: 'Nude',
  artists: ['Radiohead'],
  album: 'In Rainbows',
  durationMs: 255000,
  releaseYear: 2007,
};

const searchResponse = {
  items: [
    {
      id: { kind: 'youtube#video', videoId: 'Q7SJnEyNO3s' },
      snippet: {
        title: 'Radiohead - Nude (Official Audio)',
        channelTitle: 'Radiohead - Topic',
        channelId: 'UCq19-LqvG35A-30oyAiPiqA',
        description: 'Provided to YouTube by XL Recordings',
      },
    },
  ],
  pageInfo: { totalResults: 1, resultsPerPage: 10 },
};

describe('YouTubeProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the API key in the X-Goog-Api-Key header, not the query string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(searchResponse), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new YouTubeProvider('test-youtube-key').searchTrack(track);

    expect(result?.url).toBe('https://www.youtube.com/watch?v=Q7SJnEyNO3s');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(requestUrl).searchParams.has('key')).toBe(false);
    expect(requestUrl).not.toContain('test-youtube-key');
    expect(new Headers(init.headers).get('X-Goog-Api-Key')).toBe('test-youtube-key');
  });
});
