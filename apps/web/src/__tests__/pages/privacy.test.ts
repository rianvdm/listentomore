// ABOUTME: Tests for the privacy policy page copy.
// ABOUTME: Guards the claims that must stay true: what sign-in and lastfm-mcp links store, the effective date, and deletion.

import { describe, it, expect } from 'vitest';
import { PrivacyPage, PRIVACY_EFFECTIVE_DATE } from '../../pages/legal/privacy';

describe('PrivacyPage', () => {
  const html = PrivacyPage({ currentUser: null }).toString();
  // HTML with the &#39; and &quot; entities decoded and whitespace collapsed, for phrase checks.
  const text = html.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

  it('drops the claim that no personal information is collected', () => {
    expect(html).not.toContain('do not collect any personally identifiable information');
  });

  it('shows the new effective date', () => {
    expect(PRIVACY_EFFECTIVE_DATE).toBe('November 9, 2026');
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

  it('says a lastfm-mcp link click is recorded without IP or browser details', () => {
    expect(text).toContain('If you follow a link to this site from lastfm-mcp, I add a row to a click log');
    expect(text).toContain('not your IP address, not your browser details and not the names you looked up');
  });

  it('says a new account records that it came from lastfm-mcp', () => {
    expect(text).toContain('If you created your account after following a link from lastfm-mcp, a note saying so.');
  });

  it('says looked-up names are cached to find the page again', () => {
    expect(text).toContain('Artist and album names from a lookup link, such as one from lastfm-mcp');
    expect(text).toContain('30 days, or 1 day if nothing matched');
    expect(text).toContain('so the same lookup doesn\'t search Spotify again');
  });

  it('says the sign-up notification names where you came from', () => {
    expect(text).toContain('with the username and profile link, plus "via lastfm-mcp" if you came from there');
  });

  it('still says the site sets no cookie if you never sign in', () => {
    expect(text).toContain('If you never sign in, the site itself sets no cookie, even when you arrive from a lastfm-mcp link');
  });

  it('says the click log outlasts account deletion because it has no account link', () => {
    expect(text).toContain('The click log for lastfm-mcp links doesn\'t point to accounts');
  });

  it('explains deletion and links to the account page', () => {
    expect(html).toContain('href="/account"');
    expect(html).toContain('removes your account record and all your sessions');
    expect(html).toContain('Cached copies expire on their own schedule');
    expect(text).toContain('aren\'t removed when you delete your account');
    expect(text).toContain('The API log doesn\'t point to accounts');
  });
});
