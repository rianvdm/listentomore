// /whatis command - Get information about a music genre

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
import { capitalizeWords, genreUrl } from '../lib/format';
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

export async function handleWhatis(
  env: Env,
  services: Services,
  interaction: DiscordInteraction,
  genre: string
): Promise<void> {
  try {
    const genreCapitalized = capitalizeWords(genre);

    // Get genre summary
    const genreData = await services.ai.getGenreSummary(genre).catch((err) => {
      console.error('Genre summary error:', err);
      return null;
    });

    if (!genreData || !genreData.content) {
      await sendFollowUpMessage(env.DISCORD_APPLICATION_ID, interaction.token, {
        content: `I couldn't find information about ${genreCapitalized}.`,
        flags: MessageFlags.EPHEMERAL,
      });
      return;
    }

    // Clean the text and extract first two sentences
    const cleanedText = genreData.content
      .split('\n')
      .filter((line) => !line.trim().startsWith('##'))
      .join(' ')
      .trim();

    const sentences = cleanedText.match(/[^.!?]+[.!?]+/g) || [];
    const summary = sentences.slice(0, 2).join(' ').trim();

    const username = getUsername(interaction);

    // Send the genre info as a public message
    await sendNewMessage(env.DISCORD_TOKEN, interaction.channel_id, {
      content: `**${username}** requested more information about **${genreCapitalized}**`,
      embeds: [
        {
          title: `Genre detail: ${genreCapitalized}`,
          url: genreUrl(genre),
          description: summary || cleanedText,
          footer: {
            text: 'Visit the link for more detail and albums to check out.',
          },
        },
      ],
    });
  } catch (error) {
    console.error('Error in handleWhatis:', error);
    await sendFollowUpMessage(env.DISCORD_APPLICATION_ID, interaction.token, {
      content: 'An error occurred while fetching the genre information.',
      flags: MessageFlags.EPHEMERAL,
    });
  } finally {
    await deleteInitialResponse(env.DISCORD_APPLICATION_ID, interaction.token);
  }
}
