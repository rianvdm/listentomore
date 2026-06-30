// User insights summary prompt - generates personalized listening analysis

import { getTaskConfig } from '@listentomore/config';
import type { ChatClient, ChatMessage, AIResponseMetadata } from '../types';
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

/** Bump when the prompt changes so cached cold summaries don't linger. */
export const USER_INSIGHTS_PROMPT_VERSION = 'v2';

const SYSTEM_PROMPT =
  "You're a friend who pays attention to what people listen to. When someone shows you their week, you react to the music itself — you have opinions about records and songs, the ones you love, the ones that surprised you, the stuff you'd text them about. You know their usual rotation and what's new for them. You're not analyzing them; you're talking about the music with someone whose taste you know.";

// Hand-authored gold-standard examples in the owner's voice. Filled in Task 8
// from the worksheet. Until then this is a single neutral placeholder so the
// structure compiles and the bans/voice are exercised by tests.
const FEW_SHOT_EXAMPLES = `Here are a couple of summaries in the right voice (one with the data it came from, then two on their own):

[PLACEHOLDER — replace with the owner's hand-authored examples in Task 8]`;

/**
 * Build the chat messages for the weekly insights summary.
 * Pure — no cache, no client. Shared by generate + the A/B route.
 */
export function buildUserInsightsMessages(
  listeningData: ListeningData
): ChatMessage[] {
  const {
    topArtists,
    topAlbums,
    recentTracks,
    weeklyPlayCount,
    historicalArtists,
  } = listeningData;

  const historicalNames = new Set(
    historicalArtists.map((a) => a.name.toLowerCase())
  );
  const annotatedArtists = topArtists.map((a) => ({
    ...a,
    isRegular: historicalNames.has(a.name.toLowerCase()),
  }));

  const topArtistsSlice = annotatedArtists.slice(0, 5);
  const topAlbumsSlice = topAlbums.slice(0, 5);
  const recentTracksSlice = recentTracks.slice(0, 30);

  const userPrompt = `Here's someone's listening from the past week. Find the one thing about it that's genuinely interesting — the pattern a friend who knows their taste would call out, not a recap.

Total plays this week: ${weeklyPlayCount}

Top artists this week:
${topArtistsSlice.map((a) => `- ${a.name}: ${a.playcount} plays${a.isRegular ? ' (familiar)' : ' (new for them)'}`).join('\n')}

Top albums this week:
${topAlbumsSlice.map((a) => `- ${a.name} by ${a.artist}: ${a.playcount} plays`).join('\n')}

Recent tracks (most recent first):
${recentTracksSlice.map((t) => `- ${t.name} — ${t.artist}`).join('\n') || '- (none on record)'}

Their rotation over the past 6 months: ${historicalArtists.map((a) => a.name).join(', ') || 'none on record'}

${FEW_SHOT_EXAMPLES}

Now write theirs. 2 to 3 short paragraphs, second person. React to the music with at least one real opinion about a song or record, not a description of the listener. Name specific artists, albums, or tracks, and use the familiar/new flags. If the week is mostly their usual rotation, say so plainly, then find the small thing still worth noting.

Hard rules:
- Never use "not X — but Y", "it isn't X, it's Y", or "less like X, more like Y" anywhere. This is the move to avoid.
- At most 3 em dashes in the whole thing.
- No clichés, no recommendations, no mood/atmosphere adjectives standing in for an actual observation.`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];
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
    normalizedUsername,
    USER_INSIGHTS_PROMPT_VERSION
  );
  if (cached) {
    return cached;
  }

  const config = getTaskConfig('userInsightsSummary');
  const messages = buildUserInsightsMessages(listeningData);

  const response = await client.chatCompletion({
    model: config.model,
    messages,
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
  await cache.set('userInsightsSummary', [normalizedUsername, USER_INSIGHTS_PROMPT_VERSION], {
    content: result.content,
  });

  return result;
}
