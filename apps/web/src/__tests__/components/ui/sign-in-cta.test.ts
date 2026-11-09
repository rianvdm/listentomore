// ABOUTME: SignInCTA component rendering tests: the unlock, personal and lastfm-mcp variants.
// ABOUTME: Covers headings, bullet lists per entity and summary state, and the ref on the login link.

import { describe, it, expect } from 'vitest';
import { SignInCTA } from '../../../components/ui/SignInCTA';

describe('SignInCTA', () => {
  it('renders sign-in link with current path', () => {
    const html = SignInCTA({ currentPath: '/album/abc123' }).toString();
    expect(html).toContain('/login?next=%2Falbum%2Fabc123');
  });

  it('renders benefits list', () => {
    const html = SignInCTA({ currentPath: '/' }).toString();
    expect(html).toContain('AI-powered album and artist summaries');
    expect(html).toContain('Personalized music recommendations');
    expect(html).toContain('Weekly listening insights');
    expect(html).toContain('Your listening stats and history');
    expect(html).toContain('Public profile page');
  });

  it('renders heading', () => {
    const html = SignInCTA({ currentPath: '/' }).toString();
    expect(html).toContain('Sign in to unlock more');
  });

  describe('lastfm-mcp variant', () => {
    it('shows the Last.fm heading and the album summary bullet', () => {
      const html = SignInCTA({ currentPath: '/album/abc', variant: 'lastfm-mcp' }).toString();

      expect(html).toContain('<h3 style="margin-top:0">You already use Last.fm</h3>');
      expect(html).toContain('<p>Sign in with it to get more from ListenToMore:</p>');
      expect(html).toContain('<li>The AI summary and recommendations for this album</li>');
      expect(html).toContain('<li>Recommendations based on what you play</li>');
      expect(html).toContain('<li>Your listening stats and weekly insights</li>');
      expect(html).not.toContain('A public profile page');
      expect(html).toContain('>Sign in with Last.fm</a>');
      expect(html.indexOf('You already use Last.fm')).toBeLessThan(html.indexOf('Sign in with it to get more'));
      expect(html.indexOf('Sign in with it to get more')).toBeLessThan(html.indexOf('<ul'));
    });

    it('omits the summary bullet when a summary is shown', () => {
      const html = SignInCTA({ currentPath: '/album/abc', variant: 'lastfm-mcp', summaryShown: true }).toString();

      expect(html).toContain('You already use Last.fm');
      expect(html).not.toContain('The AI summary and recommendations');
      expect(html).toContain('<li>Recommendations based on what you play</li>');
      expect(html).toContain('<li>Your listening stats and weekly insights</li>');
      expect(html).toContain('<li>A public profile page</li>');
    });

    it('says artist on artist pages', () => {
      const html = SignInCTA({ currentPath: '/artist/abc', variant: 'lastfm-mcp', entity: 'artist' }).toString();

      expect(html).toContain('The AI summary and recommendations for this artist');
      expect(html).not.toContain('for this album');
    });

    it('adds ref to the login link', () => {
      const html = SignInCTA({ currentPath: '/album/abc', variant: 'lastfm-mcp', signInRef: 'lastfm-mcp' }).toString();

      expect(html).toContain('href="/login?next=%2Falbum%2Fabc&amp;ref=lastfm-mcp"');
    });
  });

  it('keeps existing variants unchanged', () => {
    const unlock = SignInCTA({ currentPath: '/album/abc' }).toString();
    const personal = SignInCTA({ currentPath: '/album/abc', variant: 'personal' }).toString();

    expect(unlock).toContain('<h3 style="margin-top:0">Sign in to unlock more</h3>');
    expect(personal).toContain('<h3 style="margin-top:0">Sign in with Last.fm for more</h3>');
    for (const html of [unlock, personal]) {
      expect(html).toContain('href="/login?next=%2Falbum%2Fabc"');
      expect(html).not.toMatch(/[?&;]ref=/);
      expect(html).not.toContain('You already use Last.fm');
      expect(html).not.toContain('<p>');
    }
  });
});
