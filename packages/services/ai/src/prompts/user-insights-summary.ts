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

  const prompt = `Analyze this user's recent listening activity from the past few days. Write 4-5 sentences summarizing what they've been into.

Top Artists (by play count):
${topArtists.map((a) => `- ${a.name}: ${a.playcount} plays`).join('\n')}

Top Albums:
${topAlbums.map((a) => `- ${a.name} by ${a.artist}: ${a.playcount} plays`).join('\n')}

Recent Tracks:
${recentTracks.slice(0, 10).map((t) => `- ${t.name} by ${t.artist}`).join('\n')}

Rules:
- Write in second person ("You've been...")
- Use 2-3 short paragraphs. Each paragraph should cover a distinct thread or pattern. Do NOT write everything as one long block of text.
- Mention specific artists and albums by name
- Point out patterns you notice: repeated artists, genre shifts, deep-dives into one artist, etc.
- Use clear, polished language. No invented compound adjectives, no forced metaphors, no flowery descriptions.
- Do NOT recommend anything - only describe what they listened to and what patterns stand out.
- Do NOT start with "Based on your listening..." - jump straight into the summary.
- Each sentence should say something distinct. Don't repeat the same observation in different words.`;

  const response = await client.chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content:
          'You are a music journalist writing a short, polished editorial about someone\'s listening week. You are knowledgeable and specific but never flashy. Write in clear paragraphs, not run-on sentences. Never use forced metaphors, hyphenated adjective chains, or overly creative phrasing.',
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
