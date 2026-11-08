// ABOUTME: Tests for the privacy policy page copy.
// ABOUTME: Guards the claims that must stay true: what sign-in stores, the effective date, and the deletion link.

import { describe, it, expect } from 'vitest';
import { PrivacyPage, PRIVACY_EFFECTIVE_DATE } from '../../pages/legal/privacy';

describe('PrivacyPage', () => {
  const html = PrivacyPage({ currentUser: null }).toString();
  // HTML with the &#39; entity decoded and whitespace collapsed, for phrase checks.
  const text = html.replace(/&#39;/g, "'").replace(/\s+/g, ' ');

  it('drops the claim that no personal information is collected', () => {
    expect(html).not.toContain('do not collect any personally identifiable information');
  });

  it('shows the new effective date', () => {
    expect(PRIVACY_EFFECTIVE_DATE).toBe('November 8, 2026');
    expect(html).toContain(PRIVACY_EFFECTIVE_DATE);
  });

  it('names what sign-in stores', () => {
    expect(html).toContain('Last.fm username');
    expect(html).toContain('IP address');
    expect(html).toContain('session key');
  });

  it('says session tokens are stored as a one-way hash', () => {
    expect(html).toContain('one-way hash');
  });

  it('does not name YouTube as a recipient of catalog lookups', () => {
    expect(text).not.toContain('YouTube');
    expect(text).toContain('Songlink');
  });

  it('names the cookies Cloudflare sets in front of the site', () => {
    expect(text).toContain('The only cookie this site sets is the sign-in cookie');
    expect(html).toContain('__cf_bm');
    expect(html).toContain('cf_clearance');
  });

  it('says artist pages show only your own play count, when signed in', () => {
    expect(text).toContain('When you\'re signed in, artist pages show your own Last.fm play count');
    expect(text).not.toContain('any username');
  });

  it('explains deletion and links to the account page', () => {
    expect(html).toContain('href="/account"');
    expect(html).toContain('removes your account record and all your sessions');
    expect(html).toContain('Cached copies expire on their own schedule');
    expect(text).toContain('aren\'t removed when you delete your account');
    expect(text).toContain('The API log doesn\'t point to accounts');
  });
});
