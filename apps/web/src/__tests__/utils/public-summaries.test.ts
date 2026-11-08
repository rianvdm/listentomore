// ABOUTME: Tests for server-side rendering of cached AI summaries for logged-out visitors.
// ABOUTME: Covers Markdown output, cached link HTML, sanitising, refusal cases, failed reads and the strict feature flag.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadPublicSummary, publicSummariesEnabled, renderPublicSummary } from '../../utils/public-summaries';

describe('renderPublicSummary', () => {
  it('renders Markdown to HTML', () => {
    expect(renderPublicSummary('### A\n\nb')).toContain('<h3>A</h3>');
  });

  it('renders ordinary Markdown: headings, bold and a normal https link', () => {
    const html = renderPublicSummary('## Title\n\nSome **bold** and [a site](https://example.com/x).');
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<a href="https://example.com/x">a site</a>');
  });

  it('keeps cached anchor HTML as links', () => {
    expect(renderPublicSummary('Try <a href="/album?q=x">X</a>.')).toContain('<a href="/album?q=x">X</a>');
  });

  it('keeps the placeholder album links with their data attributes', () => {
    const html = renderPublicSummary('Try <a href="/album?q=x" data-artist="A" data-album="B">X</a>.');
    expect(html).toContain('<a href="/album?q=x" data-artist="A" data-album="B">X</a>');
  });

  it('keeps relative Markdown links, as the artist placeholders produce', () => {
    expect(renderPublicSummary('See [Radiohead](/artist?q=Radiohead).')).toContain(
      '<a href="/artist?q=Radiohead">Radiohead</a>',
    );
  });

  describe('sanitising raw HTML', () => {
    it('escapes a script tag', () => {
      const html = renderPublicSummary('Hi <script>alert(1)</script> there.');
      expect(html).not.toContain('<script');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('escapes a block-level script tag', () => {
      const html = renderPublicSummary('<script>alert(1)</script>\n\nAfter.');
      expect(html).not.toContain('<script');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes an img tag with an event handler', () => {
      const html = renderPublicSummary('Look <img src=x onerror=alert(1)> here.');
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('escapes a raw anchor to an external site', () => {
      const html = renderPublicSummary('Go <a href="https://evil">here</a>.');
      expect(html).not.toContain('<a href="https://evil"');
      expect(html).toContain('&lt;a href=&quot;https://evil&quot;&gt;');
    });

    it('escapes a raw anchor with a protocol-relative href', () => {
      const html = renderPublicSummary('Go <a href="//evil.example">here</a>.');
      expect(html).not.toContain('<a href="//evil.example"');
    });

    it('escapes a raw relative anchor that carries other attributes', () => {
      const html = renderPublicSummary('Go <a href="/album?q=x" onclick="alert(1)">here</a>.');
      expect(html).not.toContain('<a href="/album?q=x" onclick');
      expect(html).toContain('&lt;a href=&quot;/album?q=x&quot; onclick=&quot;alert(1)&quot;&gt;');
    });
  });

  describe('sanitising Markdown links', () => {
    it('drops a javascript: href and keeps the text', () => {
      const html = renderPublicSummary('Click [x](javascript:alert(1)) now.');
      expect(html).not.toMatch(/javascript:/i);
      expect(html).toContain('Click x now.');
    });

    it('drops a data: href', () => {
      const html = renderPublicSummary('[x](data:text/html,hi)');
      expect(html).not.toContain('href');
      expect(html).toContain('x');
    });

    it('renders an image as its alt text only', () => {
      const html = renderPublicSummary('![logo](https://example.com/x.png)');
      expect(html).not.toContain('<img');
      expect(html).not.toContain('example.com');
      expect(html).toContain('logo');
    });

    it('escapes HTML in image alt text', () => {
      const html = renderPublicSummary('![<b>x</b>](/x.png)');
      expect(html).not.toContain('<b>');
      expect(html).not.toContain('<img');
    });

    it('keeps mailto links', () => {
      expect(renderPublicSummary('[mail](mailto:a@example.com)')).toContain('<a href="mailto:a@example.com">mail</a>');
    });
  });

  it('refuses empty and whitespace-only text', () => {
    expect(renderPublicSummary('')).toBeNull();
    expect(renderPublicSummary('   \n  ')).toBeNull();
    expect(renderPublicSummary(null)).toBeNull();
  });

  it('refuses both fallback phrases, in any case and after leading whitespace', () => {
    expect(renderPublicSummary('Not enough information available for this artist.')).toBeNull();
    expect(renderPublicSummary('There is no information available about this genre.')).toBeNull();
    expect(renderPublicSummary('not enough information available.')).toBeNull();
    expect(renderPublicSummary('  \n There is no information available.')).toBeNull();
  });

  it('renders a real summary that mentions the phrase mid-text', () => {
    const html = renderPublicSummary(
      'Early critics said there was not enough information available about the band, but the album proved them wrong.',
    );
    expect(html).toContain('not enough information available about the band');
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

describe('loadPublicSummary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the cached Markdown it reads', async () => {
    expect(await loadPublicSummary(async () => 'Some **bold** text', 'album')).toContain('<strong>bold</strong>');
  });

  it('returns null on a cache miss or a fallback reply', async () => {
    expect(await loadPublicSummary(async () => null, 'album')).toBeNull();
    expect(await loadPublicSummary(async () => 'Not enough information available.', 'album')).toBeNull();
  });

  it('logs and returns null when the read rejects or throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await loadPublicSummary(() => Promise.reject(new Error('KV down')), 'album')).toBeNull();
    expect(
      await loadPublicSummary(() => {
        throw new Error('not a promise');
      }, 'album')
    ).toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledWith('Public album summary read failed:', 'KV down', expect.any(Error));
  });
});
