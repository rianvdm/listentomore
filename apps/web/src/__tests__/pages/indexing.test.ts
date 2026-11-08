// ABOUTME: Tests which pages search engines may index: static pages carry a canonical URL,
// ABOUTME: while search results, sign-in and genre pages outside the curated list are noindex.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { AboutPage } from '../../pages/about';
import { ToolsPage } from '../../pages/tools';
import { DiscordPage } from '../../pages/discord';
import { PrivacyPage } from '../../pages/legal/privacy';
import { TermsPage } from '../../pages/legal/terms';
import { GenreSearchPage } from '../../pages/genre/search';
import { AlbumSearchPage } from '../../pages/album/search';
import { ArtistSearchPage } from '../../pages/artist/search';
import { handleGenreDetail } from '../../pages/genre/detail';
import { handleLogin } from '../../pages/auth/login';

const CANONICAL = /<link rel="canonical" href="([^"]+)"\s*\/?>/;
const NOINDEX = /<meta name="robots" content="noindex, follow"\s*\/?>/;

type TestVariables = { currentUser: unknown; internalToken: string };

function appWith(path: string, handler: (c: Context) => Response | Promise<Response>) {
  const app = new Hono<{ Variables: TestVariables }>();
  app.use('*', async (c, next) => {
    c.set('currentUser', null);
    c.set('internalToken', 'test-token');
    await next();
  });
  app.get(path, (c) => handler(c as unknown as Context));
  return app;
}

describe('static pages', () => {
  const cases: Array<[string, string]> = [
    [AboutPage({ currentUser: null }).toString(), 'https://listentomore.com/about'],
    [ToolsPage({ currentUser: null }).toString(), 'https://listentomore.com/tools'],
    [DiscordPage({ currentUser: null }).toString(), 'https://listentomore.com/discord'],
    [PrivacyPage({ currentUser: null }).toString(), 'https://listentomore.com/privacy'],
    [TermsPage({ currentUser: null }).toString(), 'https://listentomore.com/terms'],
    [GenreSearchPage({ currentUser: null }).toString(), 'https://listentomore.com/genre'],
  ];

  it.each(cases)('carries its canonical URL (%#)', (html, url) => {
    expect(html.match(CANONICAL)?.[1]).toBe(url);
    expect(html).not.toMatch(NOINDEX);
  });
});

describe('search result pages', () => {
  it('marks album search noindex', () => {
    const html = AlbumSearchPage({ query: 'ok computer', internalToken: 't', currentUser: null }).toString();
    expect(html).toMatch(NOINDEX);
  });

  it('marks artist search noindex', () => {
    const html = ArtistSearchPage({ query: 'radiohead', internalToken: 't', currentUser: null }).toString();
    expect(html).toMatch(NOINDEX);
  });
});

describe('sign-in page', () => {
  it('is noindex', async () => {
    const res = await appWith('/login', handleLogin).request('/login');
    expect(await res.text()).toMatch(NOINDEX);
  });
});

describe('genre detail pages', () => {
  const app = appWith('/genre/:slug', handleGenreDetail);

  it('keeps a curated genre indexable', async () => {
    const html = await (await app.request('/genre/shoegaze')).text();
    expect(html.match(CANONICAL)?.[1]).toBe('https://listentomore.com/genre/shoegaze');
    expect(html).not.toMatch(NOINDEX);
  });

  it('marks a genre outside the curated list noindex but still renders it', async () => {
    const res = await app.request('/genre/asdfqwerty-notreal');
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(NOINDEX);
  });
});
