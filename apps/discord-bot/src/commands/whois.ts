// /whois command - Get information about an artist

import type { SpotifyService } from '@listentomore/spotify';
import type { SonglinkService } from '@listentomore/songlink';
import type { AIService } from '@listentomore/ai';
import type { LastfmService } from '@listentomore/lastfm';

import {
  sendNewMessage,
  sendFollowUpMessage,
  deleteInitialResponse,
  MessageFlags,
} from '../lib/discord';
import { getUsername } from '../types';
import type { DiscordInteraction } from '../types';

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

export async function handleWhois(
  env: Env,
  services: Services,
  interaction: DiscordInteraction,
  artist: string
): Promise<void> {
  try {
    // Get artist sentence (takes the first artist if comma-separated)
    const artistSentence = await services.ai
      .getArtistSentence(artist.split(',')[0])
      .catch((err) => {
        console.error('Artist sentence error:', err);
        return { sentence: 'No information available for this artist.' };
      });

    const username = getUsername(interaction);

    // Send the artist info as a public message
    await sendNewMessage(env.DISCORD_TOKEN, interaction.channel_id, {
      content: `**${username}** asked about **${artist}**:\n${artistSentence.sentence}`,
    });
  } catch (error) {
    console.error('Error in handleWhois:', error);
    await sendFollowUpMessage(env.DISCORD_APPLICATION_ID, interaction.token, {
      content: 'An error occurred while fetching the artist information.',
      flags: MessageFlags.EPHEMERAL,
    });
  } finally {
    await deleteInitialResponse(env.DISCORD_APPLICATION_ID, interaction.token);
  }
}
