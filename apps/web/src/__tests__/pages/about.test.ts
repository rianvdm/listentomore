// ABOUTME: Tests for the About page: its three sections, the feature tiles and the sign-in call to action.
// ABOUTME: Also checks that the trust bullets use the same terms as the privacy policy.

import { describe, it, expect } from 'vitest';
import type { User } from '@listentomore/db';
import { AboutPage, ABOUT_FEATURES } from '../../pages/about';
import { PrivacyPage } from '../../pages/legal/privacy';

// Same fields as mockUser in handlers/account.test.ts, cast to User.
const user = {
  id: 'user-123',
  username: 'testuser',
  lastfm_username: 'testuser',
  display_name: 'Test User',
  bio: null,
  profile_visibility: 'public',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
} as unknown as User;

// The nav bar also links to /u/<name> and /account for signed-in users, so CTA
// assertions look only inside the .about-cta element.
function ctaHtml(html: string): string {
  const match = html.match(/<div class="about-cta">[\s\S]*?<\/div>/);
  if (!match) throw new Error('about-cta element not found');
  return match[0];
}

describe('AboutPage', () => {
  const signedOut = AboutPage({ currentUser: null }).toString();

  it('renders the three sections', () => {
    expect(signedOut).toContain('What you can do here');
    expect(signedOut).toContain('Signing in');
    expect(signedOut).toContain('How it&#39;s built');
  });

  it('renders six feature tiles with sized, lazy, described screenshots', () => {
    expect(ABOUT_FEATURES.map((f) => f.slug)).toEqual(['album', 'genre', 'listening', 'profile', 'discord', 'mcp']);
    for (const f of ABOUT_FEATURES) {
      expect(signedOut).toContain(`src="/images/about/${f.slug}.webp"`);
      expect(signedOut).toContain(`href="${f.href}"`);
      expect(f.alt.length).toBeGreaterThan(10);
    }
    expect(signedOut.match(/loading="lazy"/g)).toHaveLength(6);
    expect(signedOut.match(/width="1200" height="750"/g)).toHaveLength(6);
  });

  it('shows the sign-in button to signed-out visitors', () => {
    expect(ctaHtml(signedOut)).toContain('href="/login?next=%2Fabout"');
  });

  it('links signed-in users to their profile instead', () => {
    const cta = ctaHtml(AboutPage({ currentUser: { ...user, lastfm_username: 'testuser' } }).toString());
    expect(cta).toContain('href="/u/testuser"');
    expect(cta).not.toContain('/login');
  });

  it('links a signed-in user without a Last.fm username to /account', () => {
    const cta = ctaHtml(AboutPage({ currentUser: { ...user, lastfm_username: null } }).toString());
    expect(cta).toContain('href="/account"');
    expect(cta).not.toContain('/login');
  });

  it('trust bullets match privacy policy terms', () => {
    const privacy = PrivacyPage({ currentUser: null }).toString();
    for (const term of ['Last.fm username', 'IP address', 'one-way hash']) {
      expect(signedOut).toContain(term);
      expect(privacy).toContain(term);
    }
  });

  it('opens external stack links in a new tab safely', () => {
    const external = signedOut.match(/<a [^>]*href="https:[^"]*"[^>]*>/g) ?? [];
    expect(external.length).toBeGreaterThan(8);
    for (const tag of external) {
      expect(tag).toContain('target="_blank"');
      expect(tag).toContain('rel="noopener noreferrer"');
    }
  });
});
