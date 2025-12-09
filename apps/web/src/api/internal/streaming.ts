// Internal streaming links API for progressive loading

import { Hono } from 'hono';
import { StreamingLinksService } from '@listentomore/streaming-links';
import type { Bindings, Variables } from '../../types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Streaming links endpoint using our own providers (Apple Music + YouTube)
app.get('/streaming-links', async (c) => {
  const spotifyId = c.req.query('spotifyId');
  const type = c.req.query('type') as 'track' | 'album' | undefined;

  if (!spotifyId) {
    return c.json({ error: 'Missing spotifyId parameter' }, 400);
  }
  if (!type || (type !== 'track' && type !== 'album')) {
    return c.json({ error: 'Invalid type parameter, must be "track" or "album"' }, 400);
  }

  try {
    // Use secondary Spotify app for streaming-links (rate limit isolation)
    const spotify = c.get('spotifyStreaming');
    const streamingLinks = c.get('streamingLinks');

    if (type === 'album') {
      const album = await spotify.getAlbum(spotifyId);
      const metadata = StreamingLinksService.albumMetadataFromSpotify({
        id: album.id,
        name: album.name,
        artists: album.artistIds.map((_, i) => ({ name: album.artist.split(', ')[i] || album.artist })),
        total_tracks: album.tracks,
        release_date: album.releaseDate,
        external_ids: album.upc ? { upc: album.upc } : undefined,
      });

      const links = await streamingLinks.getAlbumLinks(metadata);

      // Return in legacy songlink format for backward compatibility
      return c.json({
        data: {
          pageUrl: '',
          appleUrl: links.appleMusic?.url || null,
          songlinkUrl: links.songlink,
          deezerUrl: null,
          spotifyUrl: album.url,
          tidalUrl: null,
          artistName: album.artist,
          title: album.name,
          thumbnailUrl: album.image,
          type: 'album',
        },
      });
    } else {
      // For tracks, we'd need to fetch track data from Spotify
      // For now, return an error - tracks can be added later
      return c.json({ error: 'Track streaming links not yet implemented' }, 501);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Internal streaming-links error:', errorMessage, error);
    return c.json({ error: 'Failed to fetch streaming links', details: errorMessage }, 500);
  }
});

export const streamingInternalRoutes = app;
