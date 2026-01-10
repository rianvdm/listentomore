// /listenurl command - Get streaming links for a given URL
// Supports Spotify and Apple Music URLs

import type { SpotifyService } from '@listentomore/spotify';
import type { StreamingLinksService } from '@listentomore/streaming-links';
import type { AIService } from '@listentomore/ai';
import type { LastfmService } from '@listentomore/lastfm';

import {
  sendNewMessage,
  sendFollowUpMessage,
  deleteInitialResponse,
  MessageFlags,
} from '../lib/discord';
import { albumUrl, formatStreamingLinks } from '../lib/format';
import { getUsername } from '../types';
import type { DiscordInteraction } from '../types';

interface Env {
  DISCORD_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
}

interface Services {
  spotify: SpotifyService;
  streamingLinks: StreamingLinksService;
  ai: AIService;
  lastfm: (username: string) => LastfmService;
}

const NO_IMAGE_URL = 'https://file.elezea.com/noun-no-image.png';

export async function handleListenurl(
  env: Env,
  services: Services,
  interaction: DiscordInteraction,
  songUrl: string
): Promise<void> {
  try {
    // Get streaming links using our custom service
    // This supports both Spotify and Apple Music URLs
    const linkData = await services.streamingLinks.getLinksFromUrl(songUrl, services.spotify);

    // Check if we got valid data
    if (linkData.type === 'unknown' || (!linkData.artistName || linkData.artistName === 'Unknown Artist')) {
      await sendFollowUpMessage(env.DISCORD_APPLICATION_ID, interaction.token, {
        content: "I couldn't find streaming links for this URL. Make sure it's a valid Spotify or Apple Music link.",
        flags: MessageFlags.EPHEMERAL,
      });
      return;
    }

    // For albums, try to find the Spotify ID for our album page link
    let embedUrl = '';
    if (linkData.type === 'album' && linkData.spotifyUrl) {
      const spotifyIdMatch = linkData.spotifyUrl.match(/album\/([a-zA-Z0-9]+)/);
      if (spotifyIdMatch) {
        embedUrl = albumUrl(spotifyIdMatch[1]);
      }
    }

    // Fallback: use songlink URL if available, or Spotify/Apple URL
    if (!embedUrl) {
      embedUrl = linkData.songlinkUrl || linkData.spotifyUrl || linkData.appleUrl || '';
    }

    // Get artist sentence
    const artistSentence = await services.ai
      .getArtistSentence(linkData.artistName)
      .catch((err) => {
        console.error('Artist sentence error:', err);
        return { sentence: 'Artist sentence not available' };
      });

    // Build streaming links for display
    const streamingLinks = formatStreamingLinks({
      pageUrl: linkData.songlinkUrl || '',
      spotifyUrl: linkData.spotifyUrl || undefined,
      appleUrl: linkData.appleUrl || undefined,
      deezerUrl: linkData.deezerUrl || undefined,
    });

    const username = getUsername(interaction);

    // Send the info as a public message
    await sendNewMessage(env.DISCORD_TOKEN, interaction.channel_id, {
      content: `**${username}** requested details about **${linkData.title}** by **${linkData.artistName}**\n${streamingLinks}`,
      embeds: [
        {
          title: `${linkData.title} by ${linkData.artistName}`,
          url: embedUrl,
          description: artistSentence.sentence,
          thumbnail: {
            url: linkData.thumbnailUrl || NO_IMAGE_URL,
          },
          footer: {
            text: 'Type /listenurl to fetch another URL.',
          },
        },
      ],
    });
  } catch (error) {
    console.error('Error in handleListenurl:', error);
    await sendFollowUpMessage(env.DISCORD_APPLICATION_ID, interaction.token, {
      content: 'An error occurred while fetching the streaming link.',
      flags: MessageFlags.EPHEMERAL,
    });
  } finally {
    await deleteInitialResponse(env.DISCORD_APPLICATION_ID, interaction.token);
  }
}
