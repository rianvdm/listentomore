// ABOUTME: Tests for referral parsing (ref allowlist, repeated-ref rejection) and bot detection.
// ABOUTME: A wrong referral match or a bot counted as a click both distort attribution, so edge cases are pinned.

import { describe, it, expect } from 'vitest';
import { parseRef, readRef, isBotRequest } from '../../utils/referral';

describe('parseRef', () => {
  it('accepts lastfm-mcp', () => expect(parseRef('lastfm-mcp')).toBe('lastfm-mcp'));
  it.each([undefined, null, '', 'LASTFM-MCP', 'evil', '<script>', 'lastfm-mcp '])('rejects %s', (v) =>
    expect(parseRef(v)).toBeNull());
});

describe('readRef', () => {
  it('accepts exactly one known value', () => expect(readRef(['lastfm-mcp'])).toBe('lastfm-mcp'));
  it.each([[undefined], [[]], [['evil']], [['lastfm-mcp', 'evil']], [['evil', 'lastfm-mcp']], [['lastfm-mcp', 'lastfm-mcp']]])(
    'rejects %j', (v) => expect(readRef(v)).toBeNull());
});

describe('isBotRequest', () => {
  it('flags a Cloudflare verified bot', () =>
    expect(isBotRequest('Mozilla/5.0', { botManagement: { verifiedBot: true } })).toBe(true));
  it.each([
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Claude-User/1.0',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0',
    'Mozilla/5.0 (compatible; Perplexity-User/1.0)',
    'Mozilla/5.0 (compatible; OAI-SearchBot/1.0)',
    'Mozilla/5.0 (compatible; Googlebot/2.1)',
    'Mozilla/5.0 (compatible; bingbot/2.0)',
    'curl/8.4.0',
  ])('flags %s', (ua) => expect(isBotRequest(ua, null)).toBe(true));
  it('does not flag desktop Chrome', () =>
    expect(isBotRequest('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36', null)).toBe(false));
  it('treats a missing user agent as a bot', () => expect(isBotRequest(undefined, null)).toBe(true));
});
