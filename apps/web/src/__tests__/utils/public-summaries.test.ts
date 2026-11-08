// ABOUTME: Tests for server-side rendering of cached AI summaries for logged-out visitors.
// ABOUTME: Covers Markdown output, cached link HTML, refusal cases and the strict feature flag.

import { describe, it, expect } from 'vitest';
import { publicSummariesEnabled, renderPublicSummary } from '../../utils/public-summaries';

describe('renderPublicSummary', () => {
  it('renders Markdown to HTML', () => {
    expect(renderPublicSummary('### A\n\nb')).toContain('<h3>A</h3>');
  });

  it('keeps cached anchor HTML as links', () => {
    expect(renderPublicSummary('Try <a href="/album?q=x">X</a>.')).toContain('<a href="/album?q=x">X</a>');
  });

  it('refuses empty and not-enough-information text', () => {
    expect(renderPublicSummary('')).toBeNull();
    expect(renderPublicSummary('   \n  ')).toBeNull();
    expect(renderPublicSummary('Not enough information available for this artist.')).toBeNull();
    expect(renderPublicSummary(null)).toBeNull();
  });

  it('refuses non-string cached values', () => {
    // Cached values come from KV JSON and are not runtime-checked.
    expect(renderPublicSummary({ content: 'x' } as unknown as string)).toBeNull();
    expect(renderPublicSummary(42 as unknown as string)).toBeNull();
  });
});

describe('publicSummariesEnabled', () => {
  it('reads the flag strictly', () => {
    expect(publicSummariesEnabled({ PUBLIC_CACHED_SUMMARIES: 'true' })).toBe(true);
    expect(publicSummariesEnabled({ PUBLIC_CACHED_SUMMARIES: 'false' })).toBe(false);
    expect(publicSummariesEnabled({ PUBLIC_CACHED_SUMMARIES: 'TRUE' })).toBe(false);
    expect(publicSummariesEnabled({})).toBe(false);
    expect(publicSummariesEnabled(undefined)).toBe(false);
  });
});
