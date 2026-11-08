// ABOUTME: Privacy policy page, written from docs/privacy-data-inventory.md.
// ABOUTME: Update the inventory first, then this copy, whenever what the site stores changes.

import type { User } from '@listentomore/db';
import { Layout } from '../../components/layout';

export const PRIVACY_EFFECTIVE_DATE = 'November 8, 2026';

interface PrivacyPageProps {
  currentUser?: User | null;
}

export function PrivacyPage({ currentUser }: PrivacyPageProps) {
  return (
    <Layout title="Privacy Policy" description="Privacy policy for Listen To More" currentUser={currentUser}>
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
          you sign in. Nothing on the site uses it today.
        </li>
        <li>A display name (it starts as your Last.fm username, and you can change it).</li>
        <li>The link to your Last.fm profile picture, copied from Last.fm.</li>
        <li>A short bio, if you write one on the account page.</li>
        <li>Whether your profile is public or private.</li>
        <li>When your account was created, when you last signed in, and how many times you have.</li>
      </ul>
      <p>
        I don't ask for or store your email address. Your listening history stays at Last.fm. The
        site fetches it when a page needs it and doesn't keep it in my database (see caching below
        for the short-lived copies).
      </p>
      <p>
        When a new account is created, I get a message in my own Discord server with the username
        and profile link.
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
        browser sends the cookie. I don't run a scheduled cleanup, so a session from a browser that
        never comes back can stay in the database until you delete your account.
      </p>
      <p>
        If you never sign in, the site itself sets no cookie. Your browser stores two small things on your
        device only: your light or dark theme choice, and whether you dismissed an announcement
        banner.
      </p>
      <p>
        There is also a log of calls to the site's API, which needs an API key that I hand out
        myself. Each entry has the path, status, timing, IP address and user agent of the caller.
        These entries are not linked to accounts, and the site has no job that deletes them.
      </p>

      <h2>3. Who else gets your data</h2>
      <p>
        <strong>Last.fm</strong> handles sign-in. The site also asks Last.fm for listening data
        using a Last.fm username, for example to build a profile page.
      </p>
      <p>
        <strong>Anthropic</strong> writes the text about albums, artists and genres, and answers
        questions typed into the Ask feature. For the insights page, the site sends Anthropic a
        week of listening data: total plays, your top 5 artists and top 5 albums with play counts,
        your 30 most recent tracks, and up to 20 of your top artists from the past six months. It
        doesn't send your username, display name, bio, IP address or any other account detail.
        Anthropic's own terms cover what it does with those requests. Insights for a public profile
        are generated when any signed-in visitor opens the page. Insights for a private profile are
        generated only when you open it.
      </p>
      <p>
        <strong>OpenAI</strong> generates the short random music facts. It gets no information
        about visitors.
      </p>
      <p>
        <strong>Spotify, MusicBrainz, Apple Music, YouTube and Songlink</strong> receive artist,
        album and track names or IDs, so the site can find artwork, identifiers and links on other
        services. They don't receive account details. Your browser loads album art and Last.fm
        profile pictures directly from the servers of those services, and it loads one script (a
        Markdown renderer) from the jsDelivr content network. Those hosts see your IP address the
        way any server does when you load a file from it.
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
        <li>The AI summary and album picks on your insights page: 1 day.</li>
        <li>Your Last.fm profile details and your play count for an artist: 30 days.</li>
      </ul>

      <h2>5. Private profiles</h2>
      <p>
        New accounts start as public. You can switch to private on your account page. A private
        profile hides your profile, likes and insights pages, and the data behind them, from
        everyone except you when you're signed in. It also takes you out of the recent listens feed
        on the home page and stops the 5-minute refresh of your latest track. A copy of the feed
        that was already cached can still show you for a few minutes, until it refreshes.
      </p>
      <p>
        Two things stay visible. Anyone can still see that a profile with that username exists. And
        a small public address I use on my own blog (<code>/widget/recent</code>) can show the most
        recent track for any Last.fm username without checking the setting here. Your privacy
        settings at Last.fm are separate from the ones on this site.
      </p>

      <h2>6. Deleting your account</h2>
      <p>
        You can delete your account from the <a href="/account">account page</a>. It asks you to
        type DELETE to confirm. That removes your account record and all your sessions.
      </p>
      <p>Some things outlast the deletion:</p>
      <ul>
        <li>
          Cached copies expire on their own schedule, within 30 days at most. If someone asks the
          blog address from section 5 for your latest track again, that creates a new copy that
          lasts up to 7 days.
        </li>
        <li>
          Cloudflare log entries that mention your username stay, because deleting your account doesn't remove existing logs.
        </li>
        <li>The Discord message I received when your account was created stays in Discord.</li>
        <li>The API log doesn't point to accounts, so deletion doesn't touch it.</li>
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
        cookie is the sign-in cookie described above. When I want to know how much traffic the site
        gets or where it errors, I look at Cloudflare's own dashboards and logs.
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
