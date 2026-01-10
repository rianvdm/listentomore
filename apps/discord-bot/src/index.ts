// Discord bot for ListenToMore
// Handles slash commands for music discovery

import { SpotifyService } from '@listentomore/spotify';
import { LastfmService } from '@listentomore/lastfm';
import { StreamingLinksService } from '@listentomore/streaming-links';
import { AIService } from '@listentomore/ai';

import { verifySignature } from './lib/verify';
import { createPongResponse, createEphemeralResponse, createPublicResponse } from './lib/discord';
import { registerCommands } from './register';
import { InteractionType, getOption, getUsername } from './types';
import type { DiscordInteraction } from './types';

import { handleListento } from './commands/listento';
import { handleListenlast } from './commands/listenlast';
import { handleListenurl } from './commands/listenurl';
import { handleWhois } from './commands/whois';
import { handleWhatis } from './commands/whatis';
import { handleAsk } from './commands/ask';

// Environment bindings
interface Env {
  // KV Namespace for caching
  CACHE: KVNamespace;
  // Discord credentials
  DISCORD_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_PUBLIC_KEY: string;
  // Service credentials
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  SPOTIFY_REFRESH_TOKEN: string;
  LASTFM_API_KEY: string;
  OPENAI_API_KEY: string;
  PERPLEXITY_API_KEY: string;
  // Apple MusicKit credentials (for streaming links)
  APPLE_KEY_ID: string;
  APPLE_TEAM_ID: string;
  APPLE_PRIVATE_KEY: string;
  // Environment
  ENVIRONMENT?: string;
}

// Services container
interface Services {
  spotify: SpotifyService;
  lastfm: (username: string) => LastfmService;
  streamingLinks: StreamingLinksService;
  ai: AIService;
}

// Initialize services
function createServices(env: Env): Services {
  return {
    spotify: new SpotifyService({
      clientId: env.SPOTIFY_CLIENT_ID,
      clientSecret: env.SPOTIFY_CLIENT_SECRET,
      refreshToken: env.SPOTIFY_REFRESH_TOKEN,
      cache: env.CACHE,
    }),
    // Last.fm service factory - needs username per request
    lastfm: (username: string) =>
      new LastfmService({
        apiKey: env.LASTFM_API_KEY,
        username,
      }),
    // StreamingLinksService replaces Songlink for cross-platform links
    streamingLinks: new StreamingLinksService(env.CACHE, {
      appleMusic: {
        keyId: env.APPLE_KEY_ID,
        teamId: env.APPLE_TEAM_ID,
        privateKey: env.APPLE_PRIVATE_KEY,
      },
    }),
    ai: new AIService({
      openaiApiKey: env.OPENAI_API_KEY,
      perplexityApiKey: env.PERPLEXITY_API_KEY,
      cache: env.CACHE,
    }),
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Command registration endpoint (call once to register commands with Discord)
    if (url.pathname === '/register-commands') {
      try {
        await registerCommands(env.DISCORD_APPLICATION_ID, env.DISCORD_TOKEN);
        return new Response('Commands registered successfully.', { status: 200 });
      } catch (error) {
        console.error('Failed to register commands:', error);
        return new Response(`Failed to register commands: ${error}`, { status: 500 });
      }
    }

    // Discord interaction endpoint
    if (url.pathname === '/discord-interaction') {
      // Verify Discord signature
      const signature = request.headers.get('X-Signature-Ed25519');
      const timestamp = request.headers.get('X-Signature-Timestamp');
      const body = await request.text();

      if (!signature || !timestamp) {
        return new Response('Missing signature headers', { status: 401 });
      }

      if (!verifySignature(signature, timestamp, body, env.DISCORD_PUBLIC_KEY)) {
        return new Response('Invalid request signature', { status: 401 });
      }

      const interaction: DiscordInteraction = JSON.parse(body);

      // Handle PING (Discord verification)
      if (interaction.type === InteractionType.PING) {
        return createPongResponse();
      }

      // Handle slash commands
      if (interaction.type === InteractionType.APPLICATION_COMMAND) {
        const { name } = interaction.data;
        const services = createServices(env);

        switch (name) {
          case 'listento': {
            const album = getOption(interaction, 'album');
            const artist = getOption(interaction, 'artist');
            if (!album || !artist) {
              return createEphemeralResponse('Missing album or artist parameter.');
            }
            const response = createEphemeralResponse('Fetching album details...');
            ctx.waitUntil(
              handleListento(env, services, interaction, album, artist)
            );
            return response;
          }

          case 'listenlast': {
            const lastfmUser = getOption(interaction, 'lastfm_user');
            if (!lastfmUser) {
              return createEphemeralResponse('Missing Last.fm username.');
            }
            const response = createEphemeralResponse(
              `Fetching the most recent album for ${lastfmUser}...`
            );
            ctx.waitUntil(handleListenlast(env, services, interaction, lastfmUser));
            return response;
          }

          case 'listenurl': {
            const songUrl = getOption(interaction, 'url');
            if (!songUrl) {
              return createEphemeralResponse('Missing URL.');
            }
            const response = createEphemeralResponse('Fetching streaming links...');
            ctx.waitUntil(handleListenurl(env, services, interaction, songUrl));
            return response;
          }

          case 'whois': {
            const artist = getOption(interaction, 'artist');
            if (!artist) {
              return createEphemeralResponse('Missing artist name.');
            }
            const response = createEphemeralResponse(`Fetching information for ${artist}...`);
            ctx.waitUntil(handleWhois(env, services, interaction, artist));
            return response;
          }

          case 'whatis': {
            const genre = getOption(interaction, 'genre');
            if (!genre) {
              return createEphemeralResponse('Missing genre.');
            }
            const response = createEphemeralResponse(`Fetching information for ${genre}...`);
            ctx.waitUntil(handleWhatis(env, services, interaction, genre));
            return response;
          }

          case 'ask': {
            const question = getOption(interaction, 'question');
            if (!question) {
              return createEphemeralResponse('Missing question.');
            }
            const username = getUsername(interaction);
            // For /ask, show the question publicly immediately
            const response = createPublicResponse(`**${username}** asks: ${question}`);
            ctx.waitUntil(handleAsk(env, services, interaction, question));
            return response;
          }

          default:
            return createEphemeralResponse(`Unknown command: ${name}`);
        }
      }

      return new Response('Unknown interaction type', { status: 400 });
    }

    // Fallback
    return new Response('Not Found', { status: 404 });
  },
};
