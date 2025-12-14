// User insights summary prompt - generates personalized listening analysis

import { getTaskConfig } from '@listentomore/config';
import type { ChatClient, AIResponseMetadata } from '../types';
import type { AICache } from '../cache';

export interface UserInsightsSummaryResult {
  content: string;
  metadata?: AIResponseMetadata;
}

export interface ListeningData {
  topArtists: Array<{ name: string; playcount: number }>;
  topAlbums: Array<{ name: string; artist: string; playcount: number }>;
  recentTracks: Array<{ name: string; artist: string }>;
}

/**
 * Generate a personalized summary of user's 7-day listening patterns
 */
export async function generateUserInsightsSummary(
  username: string,
  listeningData: ListeningData,
  client: ChatClient,
  cache: AICache
): Promise<UserInsightsSummaryResult> {
  const normalizedUsername = username.toLowerCase().trim();

  // Check cache first
  const cached = await cache.get<UserInsightsSummaryResult>(
    'userInsightsSummary',
    normalizedUsername
  );
  if (cached) {
    return cached;
  }

  const config = getTaskConfig('userInsightsSummary');

  const { topArtists, topAlbums, recentTracks } = listeningData;

  const prompt = `Analyze this user's listening activity from the past 7 days and write a brief, engaging summary (2-3 sentences max).

Top Artists (by play count):
${topArtists.map((a) => `- ${a.name}: ${a.playcount} plays`).join('\n')}

Top Albums:
${topAlbums.map((a) => `- ${a.name} by ${a.artist}: ${a.playcount} plays`).join('\n')}

Recent Tracks:
${recentTracks.slice(0, 10).map((t) => `- ${t.name} by ${t.artist}`).join('\n')}

Write in second person ("You've been..."). Be conversational and deeply personal.
Mention SPECIFIC artists and albums by name - make it feel like you really know their taste.
Note any interesting patterns (genre shifts, artist deep-dives, mood patterns).
Do NOT recommend anything - just summarize patterns.
Do NOT start with a preamble like "Based on your listening..." - jump straight into the insight.`;

  const response = await client.chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content:
          'You are a music-savvy friend who notices interesting patterns in listening habits. You speak casually and make insightful observations. Keep it brief and personal.',
      },
      { role: 'user', content: prompt },
    ],
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    returnCitations: false,
    reasoning: config.reasoning,
    verbosity: config.verbosity,
  });

  const result: UserInsightsSummaryResult = {
    content: response.content,
    metadata: response.metadata,
  };

  // Cache the result (without metadata)
  await cache.set('userInsightsSummary', [normalizedUsername], {
    content: result.content,
  });

  return result;
}
