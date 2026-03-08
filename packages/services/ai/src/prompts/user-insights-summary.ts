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

  const prompt = `Here is someone's listening data for the past week. Write a short editorial — 2-3 paragraphs — about their week in music.

Total plays this week: ${weeklyPlayCount}

Top Artists this week:
${annotatedArtists.map((a) => `- ${a.name}: ${a.playcount} plays${a.isRegular ? ' (a regular for them)' : ' (not in their usual rotation)'}`).join('\n')}

Top Albums this week:
${topAlbums.map((a) => `- ${a.name} by ${a.artist}: ${a.playcount} plays`).join('\n')}

Recent tracks (chronological sample):
${recentTracks.slice(0, 10).map((t) => `- ${t.name} by ${t.artist}`).join('\n')}

Their usual artists (past 3 months): ${historicalArtists.map((a) => a.name).join(', ') || 'none on record'}

Write as if you are a music journalist filing a short end-of-week column for this specific person. Find the story of the week — don't just list what they listened to. Ask: what does this week say? Was it a deep dive into one artist? A genre mood? A reunion with an old favourite? Something new breaking through?

Rules:
- Write in second person ("You spent the week...", "This was a week for...")
- 2-3 paragraphs, each with a clear point — not a list of observations strung together
- Name specific artists and albums; be concrete
- Use the regular/unusual labels to add context — note when something is a departure or a return
- Clear, direct prose. No compound adjectives, no forced metaphors, no music-crit clichés
- Do NOT recommend anything
- Do NOT open with "Based on your listening" or "This week you listened to"
- Every sentence should earn its place — cut anything that just restates something already said`;

  const response = await client.chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content:
          'You are a music journalist writing a weekly column about one person\'s listening habits. You have access to their play history and know what\'s normal for them versus what\'s new. Your job is to find the narrative thread in their week — not just report what they listened to, but say something true about it. Be specific, direct, and a little opinionated. Write like someone who actually cares about music.',
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
