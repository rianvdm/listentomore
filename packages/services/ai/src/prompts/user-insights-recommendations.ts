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
  recentTracks: Array<{ name: string; artist: string }>;
  historicalArtists: Array<{ name: string }>;
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

  const { topArtists, topAlbums, recentTracks, historicalArtists } = listeningData;

  const historicalNames = new Set(historicalArtists.map((a) => a.name.toLowerCase()));
  const annotatedArtists = topArtists.slice(0, 5).map((a) => ({
    ...a,
    isRegular: historicalNames.has(a.name.toLowerCase()),
  }));
  const topAlbumsSlice = topAlbums.slice(0, 5);
  const recentTracksSlice = recentTracks.slice(0, 30);

  const prompt = `Recommend exactly 4 albums that extend what this person is into right now. Read their week carefully, pick up on the thread or mood they're in, and suggest albums that push that thread forward — either by deepening it or opening an adjacent door.

Top artists this week:
${annotatedArtists.map((a) => `- ${a.name}: ${a.playcount} plays${a.isRegular ? ' (familiar)' : ' (new for them)'}`).join('\n')}

Top albums this week:
${topAlbumsSlice.map((a) => `- ${a.name} by ${a.artist}: ${a.playcount} plays`).join('\n')}

Recent tracks (most recent first):
${recentTracksSlice.map((t) => `- ${t.name} — ${t.artist}`).join('\n') || '- (none on record)'}

Their rotation over the past 6 months (for exclusion only, NOT for framing the recs): ${historicalArtists.map((a) => a.name).join(', ') || 'none on record'}

Rules:
- Anchor on THIS WEEK. Extend the thread or mood they're in right now. Don't design recommendations around their historical taste.
- Use the 6-month rotation only to avoid recommending artists they already listen to regularly.
- Recommend albums by artists NOT in their 6-month rotation and NOT in their top 5 this week.
- Each album must actually exist and be available on Spotify. Do not invent titles.
- The four recommendations should cover different angles of this week's thread — don't give four variations of the same vibe.
- Each reason should name the specific connection to this week: a particular artist, album, track, or mood they're sitting in right now.

Format each recommendation EXACTLY as:
**Album Name by Artist Name**: One sentence naming the specific connection.

The ONLY markdown allowed is the **...** wrapping the "Album Name by Artist Name" part. The reason sentence after the colon must be plain text — no bold, no italics, no asterisks, no brackets, no markdown of any kind.

Do NOT include any preamble ("Based on your listening...", "Here are some recommendations...").
Do NOT include closing remarks or summaries.
Just the 4 formatted recommendations, one per line.`;

  const response = await client.chatCompletion({
    model: config.model,
    messages: [
      {
        role: 'system',
        content:
          "You're a music expert who recommends albums someone will actually want to hear. You read their listening carefully — what they're deep in this week, what's on rotation for them historically, what's new vs familiar — and you pick four albums that each connect to something specific in that picture. You don't repeat what they already listen to. You name the connection in plain language. You only recommend albums that actually exist and are available on Spotify.",
      },
      { role: 'user', content: prompt },
    ],
    maxTokens: config.maxTokens,
    temperature: config.temperature,
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
