// ABOUTME: Referral `ref` parsing against a fixed allowlist, plus bot detection for click counting.
// ABOUTME: Unknown or repeated refs are dropped, and verified, scripted and missing-UA requests are not counted.

export const KNOWN_REFS = ['lastfm-mcp'] as const;
export type Ref = (typeof KNOWN_REFS)[number];

/** Exact, case-sensitive match against KNOWN_REFS. Anything else is not a referral. */
export function parseRef(value: string | null | undefined): Ref | null {
  if (value == null) return null;
  return (KNOWN_REFS as readonly string[]).includes(value) ? (value as Ref) : null;
}

/** Accepts a `ref` only when exactly one value was sent, so repeated params are dropped. */
export function readRef(values: string[] | undefined): Ref | null {
  if (values?.length !== 1) return null;
  return parseRef(values[0]);
}

const BOT_UA_PATTERN =
  /Claude-User|Claude-SearchBot|ClaudeBot|ChatGPT-User|OAI-SearchBot|GPTBot|Perplexity-User|PerplexityBot|Googlebot|bingbot|Applebot|DuckDuckBot|YandexBot|Discordbot|Slackbot|Twitterbot|facebookexternalhit|curl|wget|python-requests|node-fetch|undici|bot|crawler|spider/i;

/**
 * True for Cloudflare-verified bots, for requests with no user agent, and for
 * user agents matching a known crawler, fetcher or generic bot token.
 */
export function isBotRequest(
  userAgent: string | null | undefined,
  cf?: { botManagement?: { verifiedBot?: boolean } } | null,
): boolean {
  if (cf?.botManagement?.verifiedBot === true) return true;
  if (!userAgent) return true;
  return BOT_UA_PATTERN.test(userAgent);
}
