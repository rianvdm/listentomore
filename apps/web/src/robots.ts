// ABOUTME: robots.txt for listentomore.com: every crawler may read pages but not /api/,
// ABOUTME: and AI training crawlers are kept out entirely. Mirrors the zone's AI-training setting.

// Crawlers that collect pages to train models. Search crawlers (OAI-SearchBot,
// Claude-SearchBot, PerplexityBot) and user-triggered fetchers (ChatGPT-User,
// Claude-User, Perplexity-User) are deliberately absent: blocking them would stop
// assistants from citing or reading the site. Cloudflare's "disallow AI training"
// setting enforces this list for verified crawlers, so keep the two in step.
export const TRAINING_CRAWLERS = [
  'GPTBot',
  'ClaudeBot',
  'CCBot',
  'Google-Extended',
  'Applebot-Extended',
  'meta-externalagent',
  'Bytespider',
] as const;

// No Sitemap line until the site publishes one; a Sitemap pointing at a 404
// wastes crawl requests. No Crawl-delay: Google ignores it, and the zone's
// rate limit protects the upstream APIs.
export const ROBOTS_TXT = `# ListenToMore robots.txt
User-agent: *
Allow: /
Disallow: /api/

# AI training crawlers
${TRAINING_CRAWLERS.map((agent) => `User-agent: ${agent}`).join('\n')}
Disallow: /
`;
