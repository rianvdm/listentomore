// /ask command - Ask a question to the Rick Rubin AI

import type { SpotifyService } from '@listentomore/spotify';
import type { SonglinkService } from '@listentomore/songlink';
import type { AIService } from '@listentomore/ai';
import type { LastfmService } from '@listentomore/lastfm';

import { sendNewMessage, sendFollowUpMessage, MessageFlags } from '../lib/discord';
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

export async function handleAsk(
  env: Env,
  services: Services,
  interaction: DiscordInteraction,
  question: string
): Promise<void> {
  try {
    // Get response from Rick Rubin AI
    const aiResponse = await services.ai.askListenAI(question);

    if (!aiResponse || !aiResponse.response) {
      await sendFollowUpMessage(env.DISCORD_APPLICATION_ID, interaction.token, {
        content: "Sorry, I couldn't process your request.",
        flags: MessageFlags.EPHEMERAL,
      });
      return;
    }

    // Send the AI response as a public message
    await sendNewMessage(env.DISCORD_TOKEN, interaction.channel_id, {
      content: aiResponse.response,
    });
  } catch (error) {
    console.error('Error in handleAsk:', error);
    await sendFollowUpMessage(env.DISCORD_APPLICATION_ID, interaction.token, {
      content: "Sorry, I couldn't process your request.",
      flags: MessageFlags.EPHEMERAL,
    });
  }
  // Note: We don't delete the initial response for /ask since we show the question publicly
}
