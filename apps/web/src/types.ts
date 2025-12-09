// Shared type definitions for the Hono application
// Used across all route handlers to ensure type consistency

import type { Database, ParsedApiKey } from '@listentomore/db';
import type { SpotifyService } from '@listentomore/spotify';
import type { LastfmService } from '@listentomore/lastfm';
import type { SonglinkService } from '@listentomore/songlink';
import type { StreamingLinksService } from '@listentomore/streaming-links';
import type { AIService } from '@listentomore/ai';
import type { DiscogsService } from '@listentomore/discogs';

// Environment bindings (Cloudflare Workers)
export type Bindings = {
  // D1 Database
  DB: D1Database;
  // KV Namespaces
  CACHE: KVNamespace;
  // Environment variables
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  SPOTIFY_REFRESH_TOKEN: string;
  // Secondary Spotify app for streaming-links (rate limit isolation)
  SPOTIFY_STREAMING_CLIENT_ID?: string;
  SPOTIFY_STREAMING_CLIENT_SECRET?: string;
  SPOTIFY_STREAMING_REFRESH_TOKEN?: string;
  LASTFM_API_KEY: string;
  LASTFM_USERNAME: string;
  OPENAI_API_KEY: string;
  PERPLEXITY_API_KEY: string;
  YOUTUBE_API_KEY?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  INTERNAL_API_SECRET: string;
  ENVIRONMENT?: string;
  ADMIN_SECRET?: string;
  // Discogs API
  DISCOGS_PERSONAL_TOKEN?: string;
  DISCOGS_OAUTH_CONSUMER_KEY?: string;
  DISCOGS_OAUTH_CONSUMER_SECRET?: string;
};

// Context variables (set by middleware)
export type Variables = {
  db: Database;
  spotify: SpotifyService;
  spotifyStreaming: SpotifyService; // Secondary app for streaming-links (rate limit isolation)
  lastfm: LastfmService;
  songlink: SonglinkService;
  streamingLinks: StreamingLinksService;
  ai: AIService;
  discogs: DiscogsService;
  // Auth context
  apiKey: ParsedApiKey | null;
  authTier: 'public' | 'standard' | 'premium';
  // Internal API token (for progressive loading)
  internalToken: string;
};

// Combined app context type for Hono
export type AppContext = { Bindings: Bindings; Variables: Variables };
