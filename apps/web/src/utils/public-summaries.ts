// ABOUTME: Server-side rendering of cached AI summaries for logged-out visitors, behind a feature flag.
// ABOUTME: Sanitises model HTML and links, and refuses empty, non-string and fallback replies.

import { Marked } from 'marked';
import type { Tokens } from 'marked';
import { FALLBACK_RESPONSE_PATTERN } from '@listentomore/ai';

// Attributes the placeholder album links from replacePlaceholders carry, and nothing else.
const ALLOWED_ANCHOR_ATTRIBUTES = new Set(['href', 'data-artist', 'data-album']);
const ANCHOR_OPEN_TAG = /^<a((?:\s+[a-z-]+="[^"<>]*")*)\s*>$/;
const ANCHOR_ATTRIBUTE = /\s+([a-z-]+)="([^"<>]*)"/g;
const ANCHOR_CLOSE_TAG = /^<\/a\s*>$/;
const HTML_TAG = /<[^>]*>/g;
const SAFE_LINK_URL = /^(https?:|mailto:)/i;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Site-relative only. '//host' and '/\host' are protocol-relative in browsers, and since href values
// are emitted undecoded, an entity ('/&#47;host'), a tab or a backslash could become one after the
// browser decodes or normalises it. Placeholder hrefs are encodeURIComponent output, so they never
// contain '&', whitespace or '\'.
const SITE_RELATIVE_URL = /^\/(?![/\\])[^\s&\\]*$/;

function isSiteRelative(url: string): boolean {
  return SITE_RELATIVE_URL.test(url);
}

function isSafeLinkUrl(url: string): boolean {
  const trimmed = url.trim();
  return isSiteRelative(trimmed) || SAFE_LINK_URL.test(trimmed);
}

// Rebuilds an allowed <a> opening tag, or returns null so the caller escapes it.
function sanitizeAnchorOpenTag(tag: string): string | null {
  const match = ANCHOR_OPEN_TAG.exec(tag);
  if (!match) return null;

  const attributes = new Map<string, string>();
  for (const [, name, value] of match[1].matchAll(ANCHOR_ATTRIBUTE)) {
    if (!ALLOWED_ANCHOR_ATTRIBUTES.has(name) || attributes.has(name)) return null;
    attributes.set(name, value);
  }

  const href = attributes.get('href');
  if (href === undefined || !isSiteRelative(href)) return null;

  const rendered = [...attributes].map(([name, value]) => ` ${name}="${value}"`).join('');
  return `<a${rendered}>`;
}

// Keeps the allowed anchor tags in a raw HTML token and escapes everything else as text.
function sanitizeRawHtml(html: string): string {
  let output = '';
  let lastIndex = 0;
  for (const match of html.matchAll(HTML_TAG)) {
    const tag = match[0];
    const allowed = ANCHOR_CLOSE_TAG.test(tag) ? '</a>' : sanitizeAnchorOpenTag(tag);
    output += escapeHtml(html.slice(lastIndex, match.index)) + (allowed ?? escapeHtml(tag));
    lastIndex = match.index + tag.length;
  }
  return output + escapeHtml(html.slice(lastIndex));
}

// A private instance, so the global marked keeps its defaults for any other caller.
// Returning false from a renderer hook falls back to marked's default output.
const publicMarked = new Marked({
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return sanitizeRawHtml(text);
    },
    link({ href, tokens }: Tokens.Link): string | false {
      return isSafeLinkUrl(href) ? false : this.parser.parseInline(tokens);
    },
    // Summaries never legitimately contain images, and an external one would load for every visitor.
    image({ text }: Tokens.Image): string {
      return escapeHtml(text);
    },
  },
});

/** True only when the PUBLIC_CACHED_SUMMARIES var is exactly the string 'true'. */
export function publicSummariesEnabled(env: { PUBLIC_CACHED_SUMMARIES?: string } | undefined): boolean {
  return env?.PUBLIC_CACHED_SUMMARIES === 'true';
}

/**
 * Renders a cached Markdown summary to HTML for anonymous visitors.
 * Raw HTML is escaped except for site-relative placeholder album links, Markdown links
 * keep their href only for http(s), mailto and site-relative URLs, and images render as alt text.
 * Returns null when there is nothing worth publishing. Cached values come from KV JSON without a
 * runtime type check, so non-string input is refused too.
 */
export function renderPublicSummary(markdown: string | null): string | null {
  if (typeof markdown !== 'string') return null;
  const trimmed = markdown.trim();
  if (trimmed === '' || FALLBACK_RESPONSE_PATTERN.test(trimmed)) return null;
  return publicMarked.parse(markdown, { async: false });
}

/**
 * Reads one cached summary and renders it with renderPublicSummary. A failed read is logged and
 * treated as a miss, so a KV outage leaves the page as it renders with the flag off.
 * Takes a function rather than a promise so a synchronous throw is caught too.
 */
export async function loadPublicSummary(
  read: () => Promise<string | null>,
  context: string
): Promise<string | null> {
  try {
    return renderPublicSummary(await read());
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Public ${context} summary read failed:`, errorMessage, error);
    return null;
  }
}
