// /listenlast command - Get the most recent album played by a Last.fm user

import type { SpotifyService } from '@listentomore/spotify';
import type { SonglinkService } from '@listentomore/songlink';
import type { AIService } from '@listentomore/ai';
import type { LastfmService } from '@listentomore/lastfm';

import { sendFollowUpMessage, MessageFlags } from '../lib/discord';
import type { DiscordInteraction } from '../types';
import { handleListento } from './listento';

interface Env {
  DISCORD_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
}

interface Services {
  spotify: SpotifyService;
  songlink: SonglinkService;
  ai: AIService;
  lastfm: (username: string) => LastfmService;
}

export async function handleListenlast(
  env: Env,
  services: Services,
  interaction: DiscordInteraction,
  lastfmUser: string
): Promise<void> {
  try {
    // Create Last.fm service for this user
    const lastfm = services.lastfm(lastfmUser);

    // Get the most recent track
    const recentTrack = await lastfm.getMostRecentTrack();

    if (!recentTrack || !recentTrack.artist || !recentTrack.album) {
      await sendFollowUpMessage(env.DISCORD_APPLICATION_ID, interaction.token, {
        content: `I couldn't find any recent albums for ${lastfmUser}.`,
        flags: MessageFlags.EPHEMERAL,
      });
      return;
    }

    const { artist, album } = recentTrack;

    // Create custom intro message
    const customIntroMessage = `**${lastfmUser}** most recently listened to **${album}** by **${artist}**`;

    // Delegate to handleListento with the custom message
    await handleListento(env, services, interaction, album, artist, customIntroMessage);
  } catch (error) {
    console.error('Error in handleListenlast:', error);
    await sendFollowUpMessage(env.DISCORD_APPLICATION_ID, interaction.token, {
      content: 'An error occurred while fetching the recent album details.',
      flags: MessageFlags.EPHEMERAL,
    });
  }
}
