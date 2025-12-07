// GET /api/v1/artist - Get artist details with AI summary

import { Hono } from 'hono';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/', async (c) => {
  const query = c.req.query('q');
  const include = c.req.query('include')?.split(',') || ['summary', 'sentence', 'albums'];

  if (!query) {
    return c.json({ error: 'Missing required parameter: q' }, 400);
  }

  try {
    const spotify = c.get('spotify');
    const ai = c.get('ai');
    const lastfm = c.get('lastfm');

    // Step 1: Search for artist
    const searchResults = await spotify.search.search(query, 'artist', 1);
    if (!searchResults || searchResults.length === 0) {
      return c.json({ error: 'Artist not found', query }, 404);
    }

    const artistResult = searchResults[0];

    // Step 2: Get full artist details
    const artistData = await spotify.getArtist(artistResult.id);

    // Step 3: Fetch AI summary, sentence, and top albums in parallel
    const [summaryResult, sentenceResult, topAlbumsResult] = await Promise.all([
      include.includes('summary')
        ? ai.getArtistSummary(artistData.name).catch((err) => {
            console.error('AI artist summary error:', err);
            return null;
          })
        : Promise.resolve(null),
      include.includes('sentence')
        ? ai.getArtistSentence(artistData.name).catch((err) => {
            console.error('AI artist sentence error:', err);
            return null;
          })
        : Promise.resolve(null),
      include.includes('albums')
        ? lastfm.getArtistTopAlbums(artistData.name, 5).catch((err) => {
            console.error('Last.fm top albums error:', err);
            return [];
          })
        : Promise.resolve([]),
    ]);

    // Build response
    const response: Record<string, unknown> = {
      id: artistData.id,
      name: artistData.name,
      genres: artistData.genres,
      image: artistData.image,
      url: `https://listentomore.com/artist/${artistData.id}`,
      spotifyUrl: artistData.url,
    };

    if (summaryResult && summaryResult.summary) {
      response.summary = {
        content: summaryResult.summary,
        citations: summaryResult.citations,
        metadata: summaryResult.metadata,
      };
    }

    if (sentenceResult && sentenceResult.sentence) {
      response.sentence = sentenceResult.sentence;
    }

    if (topAlbumsResult && topAlbumsResult.length > 0) {
      response.topAlbums = topAlbumsResult.map((album) => ({
        name: album.name,
        playcount: album.playcount,
      }));
    }

    return c.json({ data: response });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('v1 artist error:', errorMessage, error);
    return c.json({ error: 'Failed to fetch artist', details: errorMessage }, 500);
  }
});

export const artistRoutes = app;
