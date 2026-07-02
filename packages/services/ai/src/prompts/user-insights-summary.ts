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

// Hand-authored gold-standard examples in the owner's voice. The first shows
// the week's input data it was written from (so the model learns to read the
// shape); the next two are just the writing.
const FEW_SHOT_EXAMPLES = `Here are a few summaries in the right voice. The first one shows the week's data it came from; the next two are just the writing.

Here's a week:

Total plays this week: 118

Top artists this week:
- Boards of Canada: 50 plays (familiar)
- Nils Frahm: 24 plays (familiar)
- Jars of Clay: 17 plays (familiar)
- Chief Xian aTunde Adjuah: 14 plays (new for them)
- Pink Floyd: 13 plays (familiar)

Top albums this week:
- Tomorrow's Harvest by Boards of Canada: 50 plays
- All Melody by Nils Frahm: 18 plays
- Bark Out Thunder Roar Out Lightning by Chief Xian aTunde Adjuah: 14 plays
- Who We Are Instead by Jars of Clay: 12 plays
- The Dark Side of the Moon by Pink Floyd: 11 plays

Recent tracks (most recent first):
- Deep Time — Boards of Canada
- The Word Becomes Flesh — Boards of Canada
- Reach for the Dead — Boards of Canada
- Blue Bossa — Joe Henderson
- Footprints — Wayne Shorter
- Mercy, Mercy, Mercy — Cannonball Adderley
- Idle Moments — Grant Green
- Why Was I Born — Kenny Burrell & John Coltrane
- Four on Six — Wes Montgomery
- Possession — Chief Xian aTunde Adjuah
- Says — Nils Frahm
- Sugar for the Pill — Slowdive
- Time — Pink Floyd
- Everything in Its Right Place — Radiohead

Their rotation over the past 6 months: Boards of Canada, Nils Frahm, Death Cab for Cutie, Radiohead, Slowdive, Pink Floyd, Jars of Clay, Deserta, Celer, Stars of the Lid, Ólafur Arnalds, Sigur Rós, Peter Gabriel, Genesis, Khruangbin, Aurenza, Somniscape, Röyksopp

What you'd write:

Two things happened this week and they couldn't be further apart. One: a 50-play Boards of Canada immersion — Deep Time and The Word Becomes Flesh on repeat, the kind of run where you stop noticing the album changed. Two: a mid-century jazz rabbit hole, completely out of left field.

The jazz dig is the story. Joe Henderson, Wayne Shorter, Cannonball Adderley, Grant Green, Kenny Burrell and Coltrane, Wes Montgomery, all in one week, none of it anywhere near your usual rotation. Good instincts, too — Joe Henderson is exactly where you start. Chief Xian aTunde Adjuah (new for you) at 14 plays says it stuck. When you fall into something, you fall all the way in.

Everything else was business as usual: Nils Frahm, Slowdive, Pink Floyd, Radiohead. But this week belonged to those two obsessions running side by side.

Here's another week, just the summary:

Siiga came out of nowhere and took the top spot in a week — Nostalgia Burns at 39 plays, and it slots right into the ambient pocket you already live in next to Celer, Nils Frahm, and Deserta. The Capri remaster got the full front-to-back treatment too, so a lot of this week was pressing play and letting a record run.

Around the ambient stuff, the familiar names held up. You went back to In Rainbows and ran the whole thing. Still the one, no argument. I Built You A Tower stayed in heavy rotation too, and the Raveonettes binge (Pe'ahi II and Lust Lust Lust back to back) was the one loud stretch this week.

The Police live album is the curveball. Certifiable at 21 plays is a lot of stage banter and crowd noise for someone who mostly listens to drone. But Every Breath You Take live still does the job.

And one more:

This was an I Built You A Tower week, full stop. You wore the whole record down to the grain — Envy the Birds, Full of Stars, Pep Talk, Stone Over Water all sitting around three plays each. When a Death Cab record clicks for you, it clicks.

Underneath it, the usual ambient names were all there: Nils Frahm at 31, plus Ólafur Arnalds, Stars of the Lid, and Sigur Rós. Seasurfer's Stay was the one new thing that stuck.

Then the weird ones, which are the fun part. Evanescence (Beautiful Lie, How Do I Heal), Michael Jackson, and Chris de Burgh all showed up the same week as Stars of the Lid. No notes. That's a healthy week.`;

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

  console.log(
    `[Insights Summary] Model: ${response.metadata?.provider ?? 'unknown'}/${response.metadata?.model ?? config.model}`
  );

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
