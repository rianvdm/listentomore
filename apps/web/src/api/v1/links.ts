// GET /api/v1/links - Get cross-platform streaming links for an album

import { Hono } from 'hono';
import { StreamingLinksService } from '@listentomore/streaming-links';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get('/', async (c) => {
  const artist = c.req.query('artist');
  const album = c.req.query('album');

  if (!artist || !album) {
    return c.json({ error: 'Missing required parameters: artist and album' }, 400);
  }

  try {
    const spotify = c.get('spotify');
    const spotifyStreaming = c.get('spotifyStreaming');
    const streamingLinks = c.get('streamingLinks');

    // Step 1: Search for the album
    const searchResult = await spotify.searchAlbumByArtist(artist, album);
    if (!searchResult) {
      return c.json({ error: 'Album not found', artist, album }, 404);
    }

    // Step 2: Get full album details for UPC
    const albumData = await spotifyStreaming.getAlbum(searchResult.id);
    const metadata = StreamingLinksService.albumMetadataFromSpotify({
      id: albumData.id,
      name: albumData.name,
      artists: albumData.artistIds.map((_, i) => ({
        name: albumData.artist.split(', ')[i] || albumData.artist,
      })),
      total_tracks: albumData.tracks,
      release_date: albumData.releaseDate,
      external_ids: albumData.upc ? { upc: albumData.upc } : undefined,
    });

    // Step 3: Get streaming links
    const links = await streamingLinks.getAlbumLinks(metadata);

    return c.json({
      data: {
        source: {
          id: albumData.id,
          name: albumData.name,
          artist: albumData.artist,
        },
        links: {
          listentomore: `https://listentomore.com/album/${albumData.id}`,
          spotify: albumData.url,
          appleMusic: links.appleMusic?.url || null,
          songlink: links.songlink,
        },
        confidence: {
          appleMusic: links.appleMusic?.confidence || null,
        },
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('v1 links error:', errorMessage, error);
    return c.json({ error: 'Failed to fetch streaming links', details: errorMessage }, 500);
  }
});

export const linksRoutes = app;
