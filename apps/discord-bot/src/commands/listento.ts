// /listento command - Get details about an album by artist

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

export async function handleListento(
  env: Env,
  services: Services,
  interaction: DiscordInteraction,
  album: string,
  artist: string,
  customIntroMessage?: string
): Promise<void> {
  try {
    // Clean up album and artist names for search
    const cleanAlbum = album.replace(/'/g, '');
    const cleanArtist = artist.replace(/'/g, '');
    const spotifyQuery = `album:"${cleanAlbum}" artist:${cleanArtist}`;

    // Search Spotify
    const spotifyResult = await services.spotify.searchAlbum(spotifyQuery);

    if (!spotifyResult) {
      await sendFollowUpMessage(env.DISCORD_APPLICATION_ID, interaction.token, {
        content: "I couldn't find this album. Bad robot.",
        flags: MessageFlags.EPHEMERAL,
      });
      return;
    }

    const releaseYear = spotifyResult.releaseDate
      ? spotifyResult.releaseDate.split('-')[0]
      : 'Unknown';

    // Fetch streaming links and artist sentence in parallel
    const [songlinkData, artistSentence] = await Promise.all([
      services.songlink.getLinks(spotifyResult.url).catch((err) => {
        console.error('Songlink error:', err);
        return null;
      }),
      services.ai.getArtistSentence(spotifyResult.artist.split(',')[0]).catch((err) => {
        console.error('Artist sentence error:', err);
        return { sentence: 'Artist sentence not available' };
      }),
    ]);

    // Build streaming links - fallback to just Spotify if Songlink fails
    const streamingLinks = songlinkData
      ? formatStreamingLinks({
          pageUrl: songlinkData.pageUrl,
          spotifyUrl: spotifyResult.url,
          appleUrl: songlinkData.appleUrl || undefined,
          deezerUrl: songlinkData.deezerUrl || undefined,
        })
      : `[Spotify](${spotifyResult.url})`;

    const username = getUsername(interaction);
    const introMessage =
      customIntroMessage ||
      `**${username}** requested details about **${spotifyResult.name}** by **${spotifyResult.artist}** (${releaseYear})`;

    // Send the album info as a public message
    await sendNewMessage(env.DISCORD_TOKEN, interaction.channel_id, {
      content: `${introMessage}\n${streamingLinks}`,
      embeds: [
        {
          title: `${spotifyResult.name} by ${spotifyResult.artist}`,
          url: albumUrl(spotifyResult.id),
          description: artistSentence.sentence,
          thumbnail: {
            url: spotifyResult.image || NO_IMAGE_URL,
          },
          footer: {
            text: 'Type /listento to find an album',
          },
        },
      ],
    });
  } catch (error) {
    console.error('Error in handleListento:', error);
    await sendFollowUpMessage(env.DISCORD_APPLICATION_ID, interaction.token, {
      content: 'An error occurred while fetching the album details.',
      flags: MessageFlags.EPHEMERAL,
    });
  } finally {
    // Delete the initial "thinking" message
    await deleteInitialResponse(env.DISCORD_APPLICATION_ID, interaction.token);
  }
}
