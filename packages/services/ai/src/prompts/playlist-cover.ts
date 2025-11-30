// Playlist cover prompt - generates DALL-E prompts for playlist artwork

import { AI_TASKS } from '@listentomore/config';
import type { OpenAIClient } from '../openai';

export interface PlaylistCoverPromptResult {
  dallePrompt: string;
}

export interface PlaylistCoverImageResult {
  imageData: string;
  isDataUrl: boolean;
}

/**
 * Generate a DALL-E prompt for a playlist cover
 */
export async function generatePlaylistCoverPrompt(
  playlistName: string,
  description: string,
  client: OpenAIClient
): Promise<PlaylistCoverPromptResult> {
  const config = AI_TASKS.playlistCoverPrompt;

  const prompt = `Create an image prompt for a playlist called "${playlistName}". Description: ${description}`;

  const response = await client.chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content: `You are a prompt engineer creating OpenAI image generation prompts for playlist covers. Follow these rules:

1. Begin with: "Create an image in the Spotify style/font that is perfect for the cover of a music playlist called <Playlist Title>."
2. Use descriptive language for the scene, style, mood, and color.
3. Describe how the text integrates visually, specifying font style (Spotify), size, and placement. Say "text overlay reads..."
4. Be clear that there should be no Spotify logo (or any other logos) on the image.

Output a concise, OpenAI-optimized prompt (400-450 characters) for a unified, stylish design.`,
      },
      { role: 'user', content: prompt },
    ],
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  });

  return {
    dallePrompt: response.content.trim(),
  };
}

/**
 * Generate a playlist cover image using DALL-E
 */
export async function generatePlaylistCoverImage(
  dallePrompt: string,
  client: OpenAIClient
): Promise<PlaylistCoverImageResult> {
  const response = await client.generateImage({
    prompt: dallePrompt,
    model: 'gpt-image-1',
    size: '1024x1024',
    quality: 'high',
  });

  return {
    imageData: response.data,
    isDataUrl: response.isDataUrl,
  };
}
