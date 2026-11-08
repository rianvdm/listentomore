// ABOUTME: About page: what the site does, what signing in stores, and the stack it runs on.
// ABOUTME: The "Signing in" bullets come from docs/privacy-data-inventory.md and must agree with /privacy.

import type { Child } from 'hono/jsx';
import type { User } from '@listentomore/db';
import { Layout } from '../../components/layout';

export interface AboutFeature {
  slug: 'album' | 'genre' | 'listening' | 'profile' | 'discord' | 'mcp';
  title: string;
  description: string;
  href: string;
  alt: string;
}

// Screenshots live at /images/about/<slug>.webp (1200x750), captured by apps/web/scripts/about-shots.mjs.
export const ABOUT_FEATURES: readonly AboutFeature[] = [
  {
    slug: 'album',
    title: 'Albums and artists',
    description: 'A summary, similar music, and links to Spotify, Apple Music and other services.',
    href: '/album/6dVIqQ8qmQ5GBnJ9shOYGE',
    alt: 'The Listen To More page for OK Computer by Radiohead, with cover art, release year and streaming links, and a panel listing what signing in adds',
  },
  {
    slug: 'genre',
    title: 'Genres',
    description: 'Start with a genre and work out from its key artists and records.',
    href: '/genre',
    alt: 'The genre page, with a genre search box and a list of popular genres',
  },
  {
    slug: 'listening',
    title: 'Your listening',
    description: 'Last.fm stats, plus weekly insights and recommendations based on what you played.',
    href: '/stats',
    alt: 'Top artists on a Listen To More profile, pulled from Last.fm',
  },
  {
    slug: 'profile',
    title: 'Your profile',
    description: "A page at /u/yourname with what you're playing and the tracks you love.",
    href: '/u/bordesak',
    alt: "The top of Rian's Listen To More profile page, with his recent listening",
  },
  {
    slug: 'discord',
    title: 'Discord bot',
    description: 'Drop album details and streaming links into any server.',
    href: '/discord',
    alt: 'The Discord bot page, with a button to add the bot to a server and its list of commands',
  },
  {
    slug: 'mcp',
    title: 'Last.fm MCP server',
    description: 'Ask Claude or another AI assistant about your listening history.',
    href: '/tools',
    alt: 'The Tools and Integrations page, which covers the Discord bot and the Last.fm MCP server',
  },
];

interface ExternalLinkProps {
  href: string;
  children: Child;
}

function ExternalLink({ href, children }: ExternalLinkProps) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function AboutCta({ currentUser }: { currentUser?: User | null }) {
  if (!currentUser) {
    return (
      <div class="about-cta">
        <a href={`/login?next=${encodeURIComponent('/about')}`} class="button button--large">
          Sign in with Last.fm
        </a>
      </div>
    );
  }

  if (currentUser.lastfm_username) {
    return (
      <div class="about-cta">
        <a href={`/u/${encodeURIComponent(currentUser.lastfm_username)}`} class="button button--large">
          Go to your profile
        </a>
      </div>
    );
  }

  return (
    <div class="about-cta">
      <a href="/account" class="button button--large">
        Go to your account
      </a>
    </div>
  );
}

interface AboutPageProps {
  currentUser?: User | null;
}

export function AboutPage({ currentUser }: AboutPageProps) {
  return (
    <Layout
      title="About"
      description="What you can do on Listen To More, what signing in with Last.fm stores, and how the site is built on Cloudflare Workers."
      currentUser={currentUser}
    >
      <h1>About Listen To More</h1>
      <p class="about-lede">
        Look up any album or artist, read a short take on why it matters, find what to play next,
        and open it on the service you already use.
      </p>

      <section>
        <h2>What you can do here</h2>
        <div class="about-grid">
          {ABOUT_FEATURES.map((feature) => (
            <a href={feature.href} class="about-tile">
              <img
                src={`/images/about/${feature.slug}.webp`}
                alt={feature.alt}
                width="1200"
                height="750"
                loading="lazy"
              />
              <span class="about-tile-text">
                <span class="about-tile-title">{feature.title}</span>
                <span class="about-tile-description">{feature.description}</span>
              </span>
            </a>
          ))}
        </div>
      </section>

      <section>
        <h2>Signing in</h2>
        <p>
          Album and artist pages and streaming links work without an account. Signing in with
          Last.fm adds AI summaries of albums, artists and genres, recommendations, your stats and
          weekly insights, and a profile page.
        </p>
        <p>
          You sign in on Last.fm's own site, so I never see your password. The short version of
          what this site keeps:
        </p>
        <ul>
          <li>
            Your Last.fm username and a link to your Last.fm profile picture, plus the display name
            and bio you can edit on your account page.
          </li>
          <li>The session key Last.fm hands back when you sign in. Nothing on the site uses it today.</li>
          <li>The IP address and browser details (user agent) of each sign-in.</li>
          <li>
            Your session token, but only as a one-way hash. The token itself sits in a cookie that
            scripts on the page can't read.
          </li>
        </ul>
        <p>
          From your <a href="/account">account page</a> you can make your profile private, or delete
          your account, which removes your account record and all your sessions. A few things
          outlast that, like cached copies and logs. The <a href="/privacy">privacy policy</a> lists
          them, along with everything else the site stores.
        </p>
        <AboutCta currentUser={currentUser} />
      </section>

      <section>
        <h2>How it's built</h2>
        <p>
          The whole site is one Cloudflare{' '}
          <ExternalLink href="https://developers.cloudflare.com/workers/">Worker</ExternalLink>{' '}
          running <ExternalLink href="https://hono.dev/">Hono</ExternalLink>. Accounts live in{' '}
          <ExternalLink href="https://developers.cloudflare.com/d1/">D1</ExternalLink>, API
          responses are cached in{' '}
          <ExternalLink href="https://developers.cloudflare.com/kv/">Workers KV</ExternalLink>, and
          a{' '}
          <ExternalLink href="https://developers.cloudflare.com/durable-objects/">
            Durable Object
          </ExternalLink>{' '}
          keeps requests to{' '}
          <ExternalLink href="https://musicbrainz.org/doc/MusicBrainz_API">MusicBrainz</ExternalLink>{' '}
          under their rate limit. A{' '}
          <ExternalLink href="https://developers.cloudflare.com/workers/configuration/cron-triggers/">
            Cron Trigger
          </ExternalLink>{' '}
          runs every five minutes to fetch each public member's latest track from Last.fm for the
          recent listens on the home page. Once an hour it also asks{' '}
          <ExternalLink href="https://openai.com/api/">OpenAI</ExternalLink> for the music fact that
          signed-in visitors see there.
        </p>
        <p>
          Album and artist data comes from the{' '}
          <ExternalLink href="https://developer.spotify.com/documentation/web-api">
            Spotify Web API
          </ExternalLink>{' '}
          and the <ExternalLink href="https://www.last.fm/api">Last.fm API</ExternalLink>. Apple
          Music links come from the{' '}
          <ExternalLink href="https://developer.apple.com/documentation/applemusicapi">
            Apple Music API
          </ExternalLink>
          , matched by the album's barcode where possible, and MusicBrainz looks up the barcode when
          Spotify doesn't have it. A <ExternalLink href="https://odesli.co/">Songlink</ExternalLink>{' '}
          page covers the other streaming services.{' '}
          <ExternalLink href="https://www.anthropic.com/claude">Claude</ExternalLink> writes the
          summaries, the weekly insights and the album recommendations.
        </p>
        <p>
          I <ExternalLink href="https://elezea.com/resume/">work at Cloudflare</ExternalLink>, and
          the site's logs and traces go to{' '}
          <ExternalLink href="https://developers.cloudflare.com/workers/observability/">
            Workers Observability
          </ExternalLink>
          , one of the products I look after there. If you want to talk
          about the project, <ExternalLink href="https://elezea.com/contact/">get in touch</ExternalLink>
          , and if something's broken or missing,{' '}
          <ExternalLink href="https://github.com/rianvdm/listentomore/issues">
            open an issue on GitHub
          </ExternalLink>
          .
        </p>
      </section>
    </Layout>
  );
}
