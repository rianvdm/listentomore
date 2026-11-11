// ABOUTME: Tests for the privacy policy page copy.
// ABOUTME: Guards the claims that must stay true: what sign-in, insights and lastfm-mcp links store, the date, and deletion.

import { describe, it, expect } from 'vitest';
import { checkCopyRubric } from '@listentomore/insights';
import { PrivacyPage, PRIVACY_EFFECTIVE_DATE } from '../../pages/legal/privacy';

/** The sentences the insights card added to the policy, as the rendered page shows them. */
const CARD_SENTENCES = [
  'The insights page sends it three kinds of request.',
  'Under the note, your insights page can show a card about an album from your week.',
  "The card names someone who played on or produced the album and a band they've been in (or the person's own name) that you've played, with your play count for it.",
  "When no such link turns up, the card gives a fact about one of your week's albums, found by Anthropic, with a link to the web page the fact came from.",
  'For that album fact, Anthropic gets only the artist and album name, and searches the web for a fact about the album.',
  'The site asks only when you open your own insights page.',
  'The fact is kept for everyone, so a card that names the same album later shows it without asking again.',
  'None of these requests includes your username, display name, bio, IP address or any other account detail.',
  'When you open your own insights page, the site also sends Spotify and MusicBrainz artist and album names from your week.',
  "Spotify gets up to six albums, to find their release dates, and the card's album, to find its cover.",
  'MusicBrainz gets up to six albums, to find who played on and produced them and which bands those people have been in.',
  "The album fact's source link points to whatever site the fact came from.",
  'Your browser contacts that site only if you click the link.',
  "That site then sees your IP address, like any site you visit, and your browser doesn't tell it which page you came from.",
  'The card under the note about your week: 8 days.',
  "Spotify's results for the album lookups behind your insights page, under the artist and album names: 30 days.",
  'Album facts for the card, with their source links: 120 days, or 30 days when no usable fact was found.',
  "They aren't tied to an account.",
  'Credits and band memberships from MusicBrainz: 30 days, or 7 days when MusicBrainz had nothing.',
  "They aren't tied to an account either.",
  'That visitor also sees the card, including any play count it names, with your username where you see "you".',
  'A visit from someone else never starts the lookups behind the card, so they see it only after your own visit has made it.',
  'It also deletes the cached copies of your listening data: the scrobbles, charts, play counts, facts, notes, card and last question kept for the insights page,',
  "Album facts and MusicBrainz credits aren't tied to an account either, and expire within 120 days.",
];

describe('PrivacyPage', () => {
  const html = PrivacyPage({ currentUser: null }).toString();
  // HTML with the &#39; and &quot; entities decoded and whitespace collapsed, for phrase checks.
  const text = html.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

  it('drops the claim that no personal information is collected', () => {
    expect(html).not.toContain('do not collect any personally identifiable information');
  });

  it('shows the new effective date', () => {
    expect(PRIVACY_EFFECTIVE_DATE).toBe('November 10, 2026');
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

  it('says the album fact sends Anthropic only the artist and album name', () => {
    expect(text).toContain('The insights page sends it three kinds of request.');
    expect(text).toContain('For that album fact, Anthropic gets only the artist and album name');
    expect(text).toContain('The site asks only when you open your own insights page.');
    expect(text).toContain('None of these requests includes your username');
    expect(text).not.toContain('Neither request includes your username');
  });

  it('names the card, its 8-day retention and that deletion removes it', () => {
    expect(text).toContain('The card under the note about your week: 8 days.');
    expect(text).toContain('facts, notes, card and last question kept for the insights page');
    expect(text).toContain('Album facts for the card, with their source links: 120 days, or 30 days when no usable fact was found.');
    expect(text).toContain('Album facts and MusicBrainz credits aren\'t tied to an account either, and expire within 120 days.');
  });

  it('says a visitor to a public profile sees the card and the play count it names', () => {
    expect(text).toContain('That visitor also sees the card, including any play count it names, with your username where you see "you".');
    expect(text).toContain('A visit from someone else never starts the lookups behind the card');
  });

  it('says MusicBrainz and Spotify get album and artist names from the owner\'s week', () => {
    expect(text).toContain('When you open your own insights page, the site also sends Spotify and MusicBrainz artist and album names from your week.');
    expect(text).toContain('Spotify gets up to six albums, to find their release dates, and the card\'s album, to find its cover.');
    expect(text).toContain('Credits and band memberships from MusicBrainz: 30 days, or 7 days when MusicBrainz had nothing.');
  });

  it('says the source link reaches its site only on a click, without the page address', () => {
    expect(text).toContain('Your browser contacts that site only if you click the link.');
    expect(text).toContain('your browser doesn\'t tell it which page you came from');
  });

  it('every sentence the card added is on the page and passes the copy rubric with no names masked', () => {
    for (const sentence of CARD_SENTENCES) {
      expect(text).toContain(sentence);
      expect({ sentence, hits: checkCopyRubric(sentence, []) }).toEqual({ sentence, hits: [] });
    }
  });
});
