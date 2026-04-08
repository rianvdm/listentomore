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

  const topArtistsSlice = annotatedArtists.slice(0, 5);
  const topAlbumsSlice = topAlbums.slice(0, 5);
  const recentTracksSlice = recentTracks.slice(0, 30);

  const prompt = `Here's someone's listening from the past week. Find the one thing about it that's genuinely interesting — the pattern a friend who knows their taste would call out, not a recap.

Total plays this week: ${weeklyPlayCount}

Top artists this week:
${topArtistsSlice.map((a) => `- ${a.name}: ${a.playcount} plays${a.isRegular ? ' (familiar)' : ' (new for them)'}`).join('\n')}

Top albums this week:
${topAlbumsSlice.map((a) => `- ${a.name} by ${a.artist}: ${a.playcount} plays`).join('\n')}

Recent tracks (most recent first):
${recentTracksSlice.map((t) => `- ${t.name} — ${t.artist}`).join('\n') || '- (none on record)'}

Their rotation over the past 6 months: ${historicalArtists.map((a) => a.name).join(', ') || 'none on record'}

Things worth looking for — pick ONE, don't try to cover everything:
- An obsession: one artist or album eating the week
- A rabbit hole: a thread from one artist, scene, or era to another
- A return: coming back to something they hadn't played in a while
- A break: stepping outside their usual rotation
- A mood: the week has a clear temperature, even across different artists
- A contrast: the gap between what they're usually into and what this week actually was

Write 2 to 3 short paragraphs in second person. Give the observation room to breathe: set it up, show the evidence in the tracks and albums, land the point. Name specific artists, albums, or tracks. Use the familiar/new flags.

Open with a direct observation — something concrete that's actually in their week. Do NOT open with a rhetorical hook ("The interesting thing is...", "What stands out is...", "Here's what's notable..."). Do NOT open with "Based on your listening" or "This week you listened to." Start in the scene, not above it.

You can be a little writerly if the observation earns it, but no clichés, no recommendations. If the week is genuinely unremarkable — mostly their usual rotation without much variation — say that plainly, then find the small thing that's still worth noting.`;

  const response = await client.chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content:
          "You're a friend who pays attention to what people listen to. When someone shares their week, you find the one thing that's actually interesting about it — not the obvious summary, but the pattern they might not have noticed themselves. You know their usual rotation and what's new for them. You write like a person, not a report: one sharp observation, specific and earned.",
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
