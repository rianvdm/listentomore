// User insights recommendations prompt - generates personalized album recommendations

import { getTaskConfig } from '@listentomore/config';
import type { ChatClient, AIResponseMetadata } from '../types';
import type { AICache } from '../cache';

export interface AlbumRecommendation {
  albumName: string;
  artistName: string;
  reason: string;
}

export interface UserInsightsRecommendationsResult {
  recommendations: AlbumRecommendation[];
  metadata?: AIResponseMetadata;
}

export interface ListeningData {
  topArtists: Array<{ name: string; playcount: number }>;
  topAlbums: Array<{ name: string; artist: string; playcount: number }>;
}

/**
 * Parse AI response to extract structured album recommendations
 */
function parseRecommendations(content: string): AlbumRecommendation[] {
  const recommendations: AlbumRecommendation[] = [];

  // Match patterns like: **Album Name by Artist Name**: reason
  // or: - **Album Name by Artist Name**: reason
  const pattern = /\*\*(.+?)\s+by\s+(.+?)\*\*[:\s]+(.+?)(?=\n|$)/gi;

  let match;
  while ((match = pattern.exec(content)) !== null) {
    const albumName = match[1].trim();
    const artistName = match[2].trim();
    let reason = match[3].trim();

    // Clean up reason - remove trailing punctuation patterns
    reason = reason.replace(/\s*\[\d+\]\s*/g, '').trim();

    if (albumName && artistName && reason) {
      recommendations.push({
        albumName,
        artistName,
        reason,
      });
    }
  }

  return recommendations;
}

/**
 * Generate personalized album recommendations based on 7-day listening
 */
export async function generateUserInsightsRecommendations(
  username: string,
  listeningData: ListeningData,
  client: ChatClient,
  cache: AICache
): Promise<UserInsightsRecommendationsResult> {
  const normalizedUsername = username.toLowerCase().trim();

  // Check cache first
  const cached = await cache.get<UserInsightsRecommendationsResult>(
    'userInsightsRecommendations',
    normalizedUsername
  );
  if (cached) {
    return cached;
  }

  const config = getTaskConfig('userInsightsRecommendations');

  const { topArtists, topAlbums } = listeningData;

  const topArtistNames = topArtists.map((a) => a.name).join(', ');
  const topAlbumsList = topAlbums
    .map((a) => `${a.name} by ${a.artist}`)
    .join(', ');

  const prompt = `Based on this user's recent 7-day listening, recommend exactly 4 albums they should check out.

Their top artists this week: ${topArtistNames}
Their top albums this week: ${topAlbumsList}

Requirements:
- Recommend albums by DIFFERENT artists than their top artists listed above
- Albums must be available on Spotify
- Include a mix of: one classic/essential album, one recent release, two deeper cuts
- Format each recommendation EXACTLY as: **Album Name by Artist Name**: One sentence explaining why they'd like it based on their taste

Do NOT include any preamble like "Based on your listening..." or "Here are some recommendations..."
Do NOT include closing remarks or summaries.
Just provide the 4 bullet-point recommendations.`;

  const response = await client.chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content:
          'You are a music expert who gives personalized album recommendations. You prioritize accuracy - only recommend albums you can verify exist and are available on streaming platforms. Be specific about why each album matches their taste.',
      },
      { role: 'user', content: prompt },
    ],
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    returnCitations: false,
    reasoning: config.reasoning,
    verbosity: config.verbosity,
    webSearch: config.webSearch,
  });

  // Parse the response into structured recommendations
  const recommendations = parseRecommendations(response.content);

  const result: UserInsightsRecommendationsResult = {
    recommendations,
    metadata: response.metadata,
  };

  // Cache the result (without metadata)
  await cache.set('userInsightsRecommendations', [normalizedUsername], {
    recommendations: result.recommendations,
  });

  return result;
}
