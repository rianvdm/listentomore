// ABOUTME: Privacy policy page, written from docs/privacy-data-inventory.md.
// ABOUTME: Update the inventory first, then this copy, whenever what the site stores changes.

import type { User } from '@listentomore/db';
import { Layout } from '../../components/layout';
import { SITE_CONFIG } from '@listentomore/config';

export const PRIVACY_EFFECTIVE_DATE = 'November 10, 2026';

interface PrivacyPageProps {
  currentUser?: User | null;
}

export function PrivacyPage({ currentUser }: PrivacyPageProps) {
  return (
    <Layout title="Privacy Policy" description="Privacy policy for Listen To More" url={`${SITE_CONFIG.url}/privacy`} currentUser={currentUser}>
      <h1>Privacy Policy</h1>
      <p>
        <strong>Effective Date:</strong> {PRIVACY_EFFECTIVE_DATE}
      </p>

      <p>
        Listen To More is a side project that I run myself. This page lists what the website and the
        Discord bot store about you, who else receives data, and how to get it removed. You can
        browse the site without an account. Everything about accounts below applies only if you sign
        in with Last.fm.
      </p>

      <h2>1. What I store when you sign in</h2>
      <p>
        You sign in on Last.fm's own page, so I never see your Last.fm password. When you approve
        the sign-in, I save this in my database:
      </p>
      <ul>
        <li>Your Last.fm username, and a lowercase copy that becomes your profile address.</li>
        <li>
          The Last.fm session key that Last.fm hands back when you sign in. I replace it each time
          you sign in.
        </li>
        <li>A display name (it starts as your Last.fm username, and you can change it).</li>
        <li>The link to your Last.fm profile picture, copied from Last.fm.</li>
        <li>A short bio, if you write one on the account page.</li>
        <li>Whether your profile is public or private.</li>
        <li>When your account was created, when you last signed in, and how many times you have.</li>
        <li>
          Your time zone, as Cloudflare works it out from your connection when you load a page while
          signed in. The insights page uses it to show your week in your own days and times. It stays
          until you delete your account.
        </li>
        <li>
          If you created your account with the sign-in button on the page a lastfm-mcp link opened, a
          note saying so. Signing up any other way, including from the Sign In link at the top of the
          page, doesn't add the note.
        </li>
      </ul>
      <p>
        I don't ask for or store your email address. Your listening history stays at Last.fm. The
        site fetches it when a page needs it and doesn't keep it in my database. The insights page
        keeps cached copies for up to 40 days (see section 4).
      </p>
      <p>
        When a new account is created, I get a message in my own Discord server with the username
        and profile link, plus "via lastfm-mcp" when the account has the lastfm-mcp note above.
      </p>

      <h2>2. Sessions, cookies, and logs</h2>
      <p>
        Signing in sets one cookie, <code>ltm_session</code>. It is marked Secure, HttpOnly and
        SameSite=Lax, and it lasts 30 days. The cookie holds a random token. My database keeps only a
        one-way hash of that token, along with the IP address and browser details (user agent) from
        the request that signed you in, the time you were last active, and when the session expires.
      </p>
      <p>
        Signing out deletes the session. If a session expires, I remove it the next time that
        browser sends the cookie.
      </p>
      <p>
        If you never sign in, the site itself sets no cookie, even when you arrive from a lastfm-mcp
        link, though Cloudflare sets its own (see section 8). Your browser also stores two small
        things on your device only: your light or dark theme choice, and whether you dismissed an
        announcement banner.
      </p>
      <p>
        If you follow a link to this site from lastfm-mcp, I add a row to a click log. The row has
        the time, that the link came from lastfm-mcp, whether you were looking for an album or an
        artist, whether the site found a match, whether you were signed in, and whether the request
        looked like it came from a bot. The row holds nothing else: not your IP address, not your
        browser details and not the names you looked up. The click log isn't linked to accounts.
      </p>
      <p>
        The artist and album names in the link go into the lookup cache (section 4). If they
        aren't cached yet, Spotify gets them as a search, and they can show up in Cloudflare's logs
        (see section 3 for both). If nothing matches, the link opens the search page with the names
        filled in, and that search is cached with the names unchanged (section 4).
      </p>
      <p>
        There is also a log of calls to the site's API, which needs an API key that I hand out
        myself. Each entry has the path, status, timing, IP address and user agent of the caller.
        These entries are not linked to accounts.
      </p>

      <h2>3. Who else gets your data</h2>
      <p>
        <strong>Last.fm</strong> handles sign-in. The site also asks Last.fm for listening data
        using a Last.fm username, for example to build a profile page.
      </p>
      <p>
        <strong>Anthropic</strong> writes the text about albums, artists and genres, and answers
        questions typed into the Ask feature. The insights page sends it three kinds of request.
      </p>
      <p>
        For the note about your week, the site first works out facts about the week from your
        listening history, such as your play count and the artists and albums you played most, with
        their play counts. Anthropic gets only those facts, and only when you open your own insights
        page.
      </p>
      <p>
        For the album picks, the site sends Anthropic your total plays, your top 5 artists and top 5
        albums of the past week with play counts, your 30 most recent tracks, and up to 20 of your
        top artists from the past six months. Album picks for a public profile are made when any
        signed-in visitor opens the page, and for a private profile only when you open it.
      </p>
      <p>
        Under the note, your insights page can show a card about an album from your week. The card
        names someone who played on or produced the album and a band they've been in (or the
        person's own name) that you've played, with your play count for it. When no such link turns
        up, the card gives a fact about one of your week's albums, found by Anthropic, with a link to
        the web page the fact came from.
      </p>
      <p>
        For that album fact, Anthropic gets only the artist and album name, and searches the web for
        a fact about the album. The site asks only when you open your own insights page. The fact is
        kept for everyone, so a card that names the same album later shows it without asking again.
      </p>
      <p>
        None of these requests includes your username, display name, bio, IP address or any other
        account detail. Anthropic's own terms cover what it does with those requests.
      </p>
      <p>
        <strong>OpenAI</strong> generates the short random music facts. It gets no information
        about visitors.
      </p>
      <p>
        <strong>Spotify, MusicBrainz and Apple Music</strong> receive artist, album and track
        names or IDs, so the site can find artwork, identifiers and links on other services. They
        don't receive account details. The "More services" link on an album page goes to
        song.link. The site sends Songlink nothing; if you click the link, Songlink sees the album's
        Spotify ID and your IP address, like any site you visit. Your browser loads album art
        and Last.fm profile pictures directly from the servers of those services, and it loads one
        script (a Markdown renderer) from the jsDelivr content network. Those hosts see your IP
        address the way any server does when you load a file from it.
      </p>
      <p>
        When you open your own insights page, the site also sends Spotify and MusicBrainz artist and
        album names from your week. Spotify gets up to six albums, to find their release dates, and
        the card's album, to find its cover. MusicBrainz gets up to six albums, to find who played on
        and produced them and which bands those people have been in.
      </p>
      <p>
        The album fact's source link points to whatever site the fact came from. Your browser
        contacts that site only if you click the link. That site then sees your IP address, like any
        site you visit, and your browser doesn't tell it which page you came from.
      </p>
      <p>
        <strong>Cloudflare</strong> hosts the site and sees every request. I have Cloudflare's
        logging and tracing turned on for the site. App messages in those logs can include usernames
        (for example when someone signs in or deletes an account) and error details. Deleting
        your account doesn't remove log entries that already exist.
      </p>
      <p>I don't sell data and I don't run ads.</p>

      <h2>4. Caching</h2>
      <p>
        To keep pages fast, the site keeps temporary copies of some data in Cloudflare's key-value
        store. Each copy expires on its own:
      </p>
      <ul>
        <li>The most recent track for each public profile: refreshed every 5 minutes, kept for up to 7 days.</li>
        <li>The home page feed of recent listens from public profiles: 7 minutes.</li>
        <li>Top artists, top albums and loved tracks: 1 hour.</li>
        <li>Artist recommendations on your profile: 6 hours.</li>
        <li>
          For the insights page, each finished day of your scrobbles (artist, album, track and the time
          you played it) and your weekly artist charts from Last.fm: up to 40 days.
        </li>
        <li>
          Your top artists for the past 3, 6 and 12 months and of all time, and your play counts for
          single artists and albums: up to 7 days.
        </li>
        <li>The facts the insights page works out about your week: 24 hours.</li>
        <li>The note about your week: 8 days.</li>
        <li>The card under the note about your week: 8 days.</li>
        <li>The last question the insights page showed you, so the next one can differ: 60 days.</li>
        <li>The album picks on your insights page: 1 day.</li>
        <li>Your Last.fm profile details and your play count for an artist: 30 days.</li>
        <li>
          The result of a lookup link, such as one from lastfm-mcp: the artist and album names, in
          lowercase without accents or punctuation, and the album or artist they matched. The lookup
          cache keeps a match for 30 days and a miss for 1 day, so the same lookup doesn't search
          Spotify again.
        </li>
        <li>
          Text searched on the album or artist search page, exactly as entered, with the results: 30
          days, even when nothing was found.
        </li>
        <li>
          Spotify's results for the album lookups behind your insights page, under the artist and
          album names: 30 days.
        </li>
        <li>
          Album facts for the card, with their source links: 120 days, or 30 days when no usable
          fact was found. They aren't tied to an account.
        </li>
        <li>
          Credits and band memberships from MusicBrainz: 30 days, or 7 days when MusicBrainz had
          nothing. They aren't tied to an account either.
        </li>
      </ul>

      <h2>5. Private profiles</h2>
      <p>
        New accounts start as public. You can switch to private on your account page. A private
        profile hides your profile, likes and insights pages from everyone except you when you're
        signed in. It also takes you out of the recent listens feed on the home page and stops the
        5-minute refresh of your latest track. A copy of the feed that was already cached can still
        show you for a few minutes, until it refreshes.
      </p>
      <p>
        On a public profile, a signed-in visitor to your insights page sees a short summary of your
        week that the site writes from the same facts, without Anthropic, plus the album picks. Only
        you see the note about your week and the question under it.
      </p>
      <p>
        That visitor also sees the card, including any play count it names, with your username
        where you see "you". A visit from someone else never starts the lookups behind the card, so
        they see it only after your own visit has made it.
      </p>
      <p>
        Anyone can still see that a profile with that username exists. When you're signed in,
        artist pages show your own Last.fm play count for that artist. Your privacy settings at
        Last.fm are separate from the ones on this site.
      </p>

      <h2>6. Deleting your account</h2>
      <p>
        You can delete your account from the <a href="/account">account page</a>. It asks you to
        type DELETE to confirm. That removes your account record and all your sessions. It also
        deletes the cached copies of your listening data: the scrobbles, charts, play counts, facts,
        notes, card and last question kept for the insights page, your Last.fm profile details, your top
        artists, top albums and loved tracks, and your play count on artist pages.
      </p>
      <p>Some things outlast the deletion:</p>
      <ul>
        <li>
          A few cached copies aren't deleted and expire on their own: your most recent track within 7
          days, the album picks within 1 day, and the artist recommendations within 6 hours. Searches
          and lookups aren't tied to an account and expire within 30 days. Album facts and MusicBrainz
          credits aren't tied to an account either, and expire within 120 days.
        </li>
        <li>
          Cloudflare log entries that mention your username aren't removed when you delete your
          account.
        </li>
        <li>The Discord message I received when your account was created stays in Discord.</li>
        <li>The API log doesn't point to accounts, so deletion doesn't touch it.</li>
        <li>The click log for lastfm-mcp links doesn't point to accounts either, so it stays too.</li>
        <li>
          Data that Last.fm, Anthropic or the other services in section 3 already hold is theirs to
          manage. Deleting here also doesn't remove this site from your Last.fm connected
          applications, which you can do in your Last.fm settings.
        </li>
      </ul>

      <h2>7. The Discord bot</h2>
      <p>
        The bot has no database. It reads the artist, album, link, Last.fm username or question
        that you type into a command, sends it to the services needed to answer (Last.fm, Anthropic,
        Spotify and the others above), and posts the reply in the channel. Music lookups can be
        cached in the same way as on the website. The bot doesn't save your commands or your Discord
        account details. Cloudflare's logs apply to it as well.
      </p>

      <h2>8. Analytics</h2>
      <p>
        I don't add analytics scripts, advertising trackers or tracking pixels to the site. The only
        cookie this site sets is the sign-in cookie described above. Cloudflare, which sits in front
        of the site, sets its own bot-detection cookie (<code>__cf_bm</code>) for every visitor, plus{' '}
        <code>cf_clearance</code> if you pass a security check.{' '}
        <a href="https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/">
          Cloudflare's cookie page
        </a>{' '}
        explains both. When I want to know how much traffic the site gets or where it errors, I look
        at Cloudflare's own dashboards and logs.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        If what the site stores changes, I'll update this page and the effective date at the top.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions, or an account that you can't delete from the account page? <a href="https://elezea.com/contact/">Contact me</a>.
      </p>
    </Layout>
  );
}
