// Album API routes:
// GET /api/v1/album - Get album details with AI summary and streaming links
// GET /api/v1/album/recommendations - Get AI-generated album recommendations

import { Hono } from 'hono';
import { StreamingLinksService } from '@listentomore/streaming-links';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/v1/album - Get album details with AI summary and streaming links
app.get('/', async (c) => {
  const artist = c.req.query('artist');
  const album = c.req.query('album');
  const include = c.req.query('include')?.split(',') || ['summary', 'links', 'tracks'];

  if (!artist || !album) {
    return c.json({ error: 'Missing required parameters: artist and album' }, 400);
  }

  try {
    const spotify = c.get('spotify');
    const spotifyStreaming = c.get('spotifyStreaming');
    const ai = c.get('ai');
    const streamingLinks = c.get('streamingLinks');

    // Step 1: Search for the album using precise search
    const searchResult = await spotify.searchAlbumByArtist(artist, album);
    if (!searchResult) {
      return c.json({ error: 'Album not found', artist, album }, 404);
    }

    // Step 2: Fetch full album details
    const albumData = await spotify.getAlbum(searchResult.id);

    // Step 3: Fetch AI summary and streaming links in parallel (if requested)
    const [summaryResult, linksResult] = await Promise.all([
      include.includes('summary')
        ? ai.getAlbumDetail(albumData.artist, albumData.name).catch((err) => {
            console.error('AI album summary error:', err);
            return null;
          })
        : Promise.resolve(null),
      include.includes('links')
        ? (async () => {
            try {
              const albumForLinks = await spotifyStreaming.getAlbum(searchResult.id);
              const metadata = StreamingLinksService.albumMetadataFromSpotify({
                id: albumForLinks.id,
                name: albumForLinks.name,
                artists: albumForLinks.artistIds.map((_, i) => ({
                  name: albumForLinks.artist.split(', ')[i] || albumForLinks.artist,
                })),
                total_tracks: albumForLinks.tracks,
                release_date: albumForLinks.releaseDate,
                external_ids: albumForLinks.upc ? { upc: albumForLinks.upc } : undefined,
              });
              return await streamingLinks.getAlbumLinks(metadata);
            } catch (err) {
              console.error('Streaming links error:', err);
              return null;
            }
          })()
        : Promise.resolve(null),
    ]);

    // Build response
    const response: Record<string, unknown> = {
      id: albumData.id,
      name: albumData.name,
      artist: albumData.artist,
      artistId: albumData.artistIds[0] || null,
      releaseDate: albumData.releaseDate,
      genres: albumData.genres,
      image: albumData.image,
      url: albumData.url,
    };

    if (include.includes('tracks')) {
      response.tracks = albumData.trackList;
    }

    if (summaryResult) {
      response.summary = {
        content: summaryResult.content,
        citations: summaryResult.citations,
        metadata: summaryResult.metadata,
      };
    }

    if (linksResult) {
      response.links = {
        listentomore: `https://listentomore.com/album/${albumData.id}`,
        spotify: albumData.url,
        appleMusic: linksResult.appleMusic?.url || null,
        songlink: linksResult.songlink,
      };
      response.confidence = {
        appleMusic: linksResult.appleMusic?.confidence || null,
      };
    } else {
      // Always include listentomore link even if streaming links not requested
      response.links = {
        listentomore: `https://listentomore.com/album/${albumData.id}`,
        spotify: albumData.url,
      };
    }

    return c.json({ data: response });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('v1 album error:', errorMessage, error);
    return c.json({ error: 'Failed to fetch album', details: errorMessage }, 500);
  }
});

// GET /api/v1/album/recommendations - Get AI-generated album recommendations
app.get('/recommendations', async (c) => {
  const artist = c.req.query('artist');
  const album = c.req.query('album');

  if (!artist || !album) {
    return c.json({ error: 'Missing required parameters: artist and album' }, 400);
  }

  try {
    const spotify = c.get('spotify');
    const ai = c.get('ai');

    // Step 1: Search for the album to validate it exists and get correct names
    const searchResult = await spotify.searchAlbumByArtist(artist, album);
    if (!searchResult) {
      return c.json({ error: 'Album not found', artist, album }, 404);
    }

    // Step 2: Get AI recommendations
    const recommendations = await ai.getAlbumRecommendations(searchResult.artist, searchResult.name);

    return c.json({
      data: {
        source: {
          id: searchResult.id,
          name: searchResult.name,
          artist: searchResult.artist,
          url: `https://listentomore.com/album/${searchResult.id}`,
        },
        recommendations: {
          content: recommendations.content,
          citations: recommendations.citations,
          metadata: recommendations.metadata,
        },
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('v1 album recommendations error:', errorMessage, error);
    return c.json({ error: 'Failed to generate recommendations', details: errorMessage }, 500);
  }
});

export const albumRoutes = app;
