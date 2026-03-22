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
  weeklyPlayCount: number;
  historicalArtists: Array<{ name: string }>;
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

  const { topArtists, topAlbums, recentTracks, weeklyPlayCount, historicalArtists } = listeningData;

  const historicalNames = new Set(historicalArtists.map((a) => a.name.toLowerCase()));
  const annotatedArtists = topArtists.map((a) => ({
    ...a,
    isRegular: historicalNames.has(a.name.toLowerCase()),
  }));

  const topArtistsSlice = annotatedArtists.slice(0, 3);
  const topAlbumsSlice = topAlbums.slice(0, 3);

  const prompt = `Here is someone's listening data for the past week. Write one short paragraph — 3 to 5 sentences — that captures the single most interesting thread from their week.

Total plays: ${weeklyPlayCount}

Top artists:
${topArtistsSlice.map((a) => `- ${a.name}: ${a.playcount} plays${a.isRegular ? ' (familiar)' : ' (new for them)'}`).join('\n')}

Top albums:
${topAlbumsSlice.map((a) => `- ${a.name} by ${a.artist}: ${a.playcount} plays`).join('\n')}

Their usual rotation (past 3 months): ${historicalArtists.map((a) => a.name).join(', ') || 'none on record'}

Pick the one thing that defines this week — a deep dive, a new discovery, a return to something familiar, a genre mood — and say something about it. Ignore data points that don't serve that thread.

Rules:
- One paragraph, 3-5 sentences. No more.
- Write in second person ("You spent the week...", "This was a week for...")
- Name specific artists and albums
- Use the familiar/new labels to add context
- Clear, direct prose. No compound adjectives, no forced metaphors, no clichés
- Do NOT recommend anything
- Do NOT open with "Based on your listening" or "This week you listened to"
- Every sentence should earn its place`;

  const response = await client.chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content:
          'You distill a week of listening into one sharp observation. You know what\'s normal for this person and what\'s new. Your job is to find the single thread that makes this week worth noting — then say it in a few sentences. Be specific and direct. Skip anything that doesn\'t serve that one point.',
      },
      { role: 'user', content: prompt },
    ],
    maxTokens: config.maxTokens,
    temperature: config.temperature,
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
