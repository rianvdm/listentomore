// ABOUTME: Tests for the privacy policy page copy.
// ABOUTME: Guards the claims that must stay true: what sign-in, insights and lastfm-mcp links store, the date, and deletion.

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

  it('says a new account records lastfm-mcp only when created from the sign-in button the link led to', () => {
    expect(text).toContain('If you created your account with the sign-in button on the page a lastfm-mcp link opened, a note saying so.');
    expect(text).toContain('Signing up any other way, including from the Sign In link at the top of the page, doesn\'t add the note.');
    expect(text).not.toContain('after following a link from lastfm-mcp, a note saying so');
  });

  it('says looked-up names are cached to find the page again, scoped to the lookup cache', () => {
    expect(text).toContain('The lookup cache keeps a match for 30 days and a miss for 1 day');
    expect(text).toContain('so the same lookup doesn\'t search Spotify again');
    expect(text).not.toContain('30 days, or 1 day if nothing matched');
  });

  it('says searches are cached as typed for 30 days, including the search a missed lookup opens', () => {
    expect(text).toContain('Text searched on the album or artist search page, exactly as entered, with the results: 30 days, even when nothing was found.');
    expect(text).toContain('If nothing matches, the link opens the search page with the names filled in, and that search is cached with the names unchanged (section 4).');
  });

  it('says the sign-up notification names lastfm-mcp only when the account has the note', () => {
    expect(text).toContain('with the username and profile link, plus "via lastfm-mcp" when the account has the lastfm-mcp note above');
    expect(text).not.toContain('if you came from there');
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
    expect(text).toContain('aren\'t removed when you delete your account');
    expect(text).toContain('The API log doesn\'t point to accounts');
  });

  it('the privacy page names stored listening history, the timezone and their retention', () => {
    expect(text).toContain('Your time zone, as Cloudflare works it out from your connection');
    expect(text).toContain('It stays until you delete your account.');
    expect(text).toContain('up to 40 days');
    expect(text).toContain('The facts the insights page works out about your week: 24 hours.');
    expect(text).toContain('The note about your week: 8 days.');
    expect(text).not.toContain('The AI summary and album picks on your insights page: 1 day.');
  });

  it('says the week note goes to Anthropic only for the owner, and what a visitor sees', () => {
    expect(text).toContain('Anthropic gets only those facts, and only when you open your own insights page');
    expect(text).toContain('Only you see the note about your week and the question under it.');
    expect(text).not.toContain('Insights for a public profile are generated when any signed-in visitor opens the page');
  });

  it('says deletion removes the cached listening data, and names what expires on its own', () => {
    expect(text).toContain('It also deletes the cached copies of your listening data');
    expect(text).toContain('A few cached copies aren\'t deleted and expire on their own');
    expect(text).not.toContain('Cached copies expire on their own schedule, within 30 days at most.');
  });
});
