// /listenurl command - Get streaming links for a given URL

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
import { albumUrl, formatStreamingLinks } from '../lib/format';
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

const NO_IMAGE_URL = 'https://file.elezea.com/noun-no-image.png';

export async function handleListenurl(
  env: Env,
  services: Services,
  interaction: DiscordInteraction,
  songUrl: string
): Promise<void> {
  try {
    // Get streaming links from Songlink
    const songlinkData = await services.songlink.getLinks(songUrl);

    if (!songlinkData.pageUrl) {
      await sendFollowUpMessage(env.DISCORD_APPLICATION_ID, interaction.token, {
        content: "I couldn't find a streaming link for this URL.",
        flags: MessageFlags.EPHEMERAL,
      });
      return;
    }

    if (!songlinkData.artistName || !songlinkData.title) {
      await sendFollowUpMessage(env.DISCORD_APPLICATION_ID, interaction.token, {
        content: "The streaming service couldn't identify the artist or title for this URL.",
        flags: MessageFlags.EPHEMERAL,
      });
      return;
    }

    // For albums, try to find the Spotify ID for our album page link
    let embedUrl = songlinkData.pageUrl;

    if (songlinkData.type === 'album' && songlinkData.spotifyUrl) {
      // Extract Spotify ID from URL (e.g., https://open.spotify.com/album/abc123)
      const spotifyIdMatch = songlinkData.spotifyUrl.match(/album\/([a-zA-Z0-9]+)/);
      if (spotifyIdMatch) {
        embedUrl = albumUrl(spotifyIdMatch[1]);
      }
    }

    // Get artist sentence
    const artistSentence = await services.ai
      .getArtistSentence(songlinkData.artistName)
      .catch((err) => {
        console.error('Artist sentence error:', err);
        return { sentence: 'Artist sentence not available' };
      });

    // Build streaming links
    const streamingLinks = formatStreamingLinks({
      pageUrl: songlinkData.pageUrl,
      spotifyUrl: songlinkData.spotifyUrl || undefined,
      appleUrl: songlinkData.appleUrl || undefined,
      deezerUrl: songlinkData.deezerUrl || undefined,
    });

    const username = getUsername(interaction);

    // Send the info as a public message
    await sendNewMessage(env.DISCORD_TOKEN, interaction.channel_id, {
      content: `**${username}** requested details about **${songlinkData.title}** by **${songlinkData.artistName}**\n${streamingLinks}`,
      embeds: [
        {
          title: `${songlinkData.title} by ${songlinkData.artistName}`,
          url: embedUrl,
          description: artistSentence.sentence,
          thumbnail: {
            url: songlinkData.thumbnailUrl || NO_IMAGE_URL,
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
