# Design: About page refresh and privacy policy rewrite

**Date:** 2026-11-08
**Status:** Design, approved in conversation (owner asked for build to proceed)
**Branch:** `about-page-refresh`

## Why

`/about` (`apps/web/src/pages/about/index.tsx`) last had a content change in February 2026. It is out of date and dull:

- It credits "Last.fm, Spotify, and OpenAI". Since v1.6.0 nearly every AI task runs on Claude (`packages/config/src/ai.ts`), and album data has relied on MusicBrainz since v1.3.0.
- It never mentions that AI features need a free Last.fm sign-in (v1.5.0).
- It names two features. Genres, public profiles, weekly insights, likes, the Tools page and the Last.fm MCP server are missing.
- It is one paragraph of prose plus a sentence of links, with no structure and nothing to look at.

The privacy policy (`apps/web/src/pages/legal/privacy.tsx`, effective September 16, 2024) predates sign-in and says "We do not collect any personally identifiable information." The site now stores Last.fm usernames, Last.fm session keys, profile details, and the IP address and user agent of every sign-in session. A visitor checking whether sign-in is safe would find a policy that contradicts the site. Fixing that is part of this project.

## Who it's for and what success looks like

The reader is someone curious about what the site does and how it's built. After reading, the owner wants them to **sign in with Last.fm and trust that it's safe to do so**. "How it's built" means the stack, not the project's history.

Success: a visitor can see in one scroll what they can do on the site, what signing in adds, exactly what is stored and how it's protected, and what the site runs on, with a sign-in button where the trust explanation ends. Every factual claim on both pages matches the code.

## Goals

1. Rewrite `/about` with three sections: "What you can do here", "Signing in", "How it's built".
2. Show real screenshots of the site in the feature tiles.
3. Rewrite `/privacy` so it accurately describes what is stored, what is sent to third parties, and how to delete it.

## Non-goals

- The Terms page (`/terms`, also dated 2024). Out of scope (builder's call, flagged to owner).
- Navigation, footer, or homepage changes.
- New features, new settings, or changes to what data is collected.
- Deploying. The work stops at a running local dev server for owner review.

## Anti-goals (failure even if it "works")

- Any claim on either page that the code doesn't support (a stored field we don't store, a service we don't call, a protection we don't have). Fabricated precision is worse than vagueness.
- A privacy policy that's shorter or vaguer than the truth to look reassuring.
- Screenshots that show anyone's data other than the owner's, or mocked/fabricated UI.
- Copy that reads as AI-written. Follow `~/git/product-ai/01-context/avoid-ai-patterns.md` and `~/git/product-ai/01-context/writing-style-personal.md`.
- Breaking dark mode or mobile layout.

## The About page (decided)

Layout and copy were approved from a mockup (`.superpowers/brainstorm/*/content/layout-v2.html`, local only). Structure, top to bottom:

### Header

`<h1>About Listen To More</h1>` then one centered lede sentence:

> Look up any album or artist, read a short take on why it matters, find what to play next, and open it on the service you already use.

### "What you can do here"

A grid of six tiles (3 columns desktop, 2 at ≤640px, 1 at narrow phone widths is the builder's call). Each tile is a link with a screenshot on top and a bold title plus one sentence below:

| Tile | Links to | Draft sentence |
|---|---|---|
| Albums and artists | an example album page | A summary, similar music, and links to Spotify, Apple Music and YouTube. |
| Genres | `/genre` | Start with a genre and work out from its key artists and records. |
| Your listening | `/stats` | Last.fm stats, plus weekly insights and recommendations based on what you played. |
| Your profile | `/u/bordesak` (owner's profile) | A public page at /u/yourname with what you're playing and what you love. |
| Discord bot | `/discord` | Drop album details and streaming links into any server. |
| Last.fm MCP server | `/tools` | Ask Claude or another AI assistant about your listening history. |

Verify every sentence against the code before shipping (for example, which streaming services the album page actually links). Adjust wording to match reality; don't adjust reality.

### "Signing in"

Plain prose and a bullet list. **No border, no background fill** (the owner rejected the boxed version). Draft:

> Album and artist pages, genres and streaming links work without an account. Sign in with Last.fm to get the AI summaries and recommendations, your stats and insights, and a profile page.
>
> You sign in on Last.fm's own site, so I never see your password. Here's what this site keeps:
>
> - Your Last.fm username, and the profile details you choose to add
> - A record of each sign-in (IP address and browser), so sessions can be checked and revoked
> - Session tokens only as a one-way hash, in a cookie scripts on the page can't read
>
> You can make your profile private or delete your account and everything tied to it from your account page. The privacy policy has the details.

Then a centered primary button, "Sign in with Last.fm", linking to the existing login flow (`/login` or `/auth/lastfm`, whichever the rest of the site uses). For a signed-in visitor, replace the button with a link to their own profile or account page (builder's call which; the page already receives `currentUser`).

The bullet list must match what the code stores. Facts checked so far: sessions store `token_hash` (SHA-256), `user_agent`, `ip_address` (`apps/web/src/utils/session.ts`); the cookie is `httpOnly`, `secure`, `SameSite=Lax`; users have `lastfm_session_key` stored. "So sessions can be checked and revoked" is a draft justification; confirm what the IP/UA are actually used for and reword if needed. The Last.fm session key is stored too; decide whether the About page needs to mention it (the privacy policy must).

### "How it's built"

Narrative prose in first person, every product name linking to its official docs or developer page. Draft:

> The whole site is one Cloudflare Worker running Hono. Accounts live in D1, API responses are cached in Workers KV, and a Durable Object keeps requests to MusicBrainz under their rate limit. A Cron Trigger refreshes the home page feed every few minutes.
>
> Album and artist data comes from the Spotify Web API, MusicBrainz and the Last.fm API. Streaming links come from Songlink, with Apple Music and YouTube lookups to fill the gaps. Claude writes the summaries and recommendations.
>
> And yes, I work at Cloudflare. I'd still build it this way. If you want to talk about the project, get in touch, and if something's broken or missing, open an issue on GitHub.

Known accuracy points to resolve:

- The cron (`scheduled()` in `apps/web/src/index.tsx`, every 5 minutes) pre-warms recent-listens data for users and generates a random fact at the top of the hour. Describe what it actually does.
- One AI task still runs on OpenAI (`gpt-5.6-luna` in `packages/config/src/ai.ts`). "Claude writes the summaries and recommendations" must stay true for the tasks it names; mention OpenAI if leaving it out would mislead.
- The Discord bot is a separate Worker (`apps/discord-bot`). "The whole site is one Worker" is about the website; keep it that way.
- Workers Observability (logs, traces) is enabled in `apps/web/wrangler.toml`. Including it is the builder's call; the owner runs that product at Cloudflare, so it's a reasonable mention.
- Links: "I work at Cloudflare" -> `https://elezea.com/resume/`; "get in touch" -> `https://elezea.com/contact/`; GitHub issues -> `https://github.com/rianvdm/listentomore/issues` (all three exist on the current page).

## Screenshots (decided: real screenshots)

- Real captures of the live site, no mocks. Logged-out views are fine; crop to the top of the page so gated AI sections aren't the focus.
- The profile tile shows the owner's own profile (`bordesak`). No other user's data anywhere.
- Capture must be repeatable: a script in `apps/web/scripts/` plus a `package.json` script, so the owner can refresh images after UI changes. Headless Chrome is available on this Mac. Note: `--window-size` below 500px is clamped; use CDP device emulation for small viewports. Production may serve a bot challenge to automated clients; if so, capture from local dev with real data or ask, and never fake content.
- Serve from Workers static assets (`apps/web/public/`, served via the `[assets]` block in `apps/web/wrangler.toml`). Use a compressed format (WebP or optimized PNG), set `width`/`height` to avoid layout shift, `loading="lazy"`, meaningful `alt` text.
- Discord bot and MCP tiles: if a real Discord embed or AI chat can't be captured by script, screenshot the site's own `/discord` and `/tools` pages instead.

## Privacy policy rewrite (decided: in scope)

Rewrite `/privacy` in plain English, first person, with a new effective date (ship date). Derive every statement from the code, not from the old policy. Cover:

1. **What's stored when you sign in:** the actual columns written for users (`packages/db/src/schema.ts`, `packages/db/src/index.ts`), including `lastfm_session_key`; only list fields the code actually populates (check `email`, `discogs_username`, `spotify_connected`).
2. **Sessions:** hashed token, IP address, user agent, expiry; cookie flags; session lifetime (`SESSION_DURATION`).
3. **API keys**, if public API keys exist for users: `api_usage_log` stores IP and user agent per request.
4. **Third parties and what they receive:** Last.fm (sign-in, listening data); Anthropic and OpenAI (album/artist info, and for signed-in insights, the user's listening data, so check exactly what the insights prompt sends); Spotify, MusicBrainz, Apple/iTunes, YouTube, Songlink (catalog lookups); Cloudflare as host, including Workers Observability logs and traces.
5. **Caching:** what's cached in KV that relates to a user (e.g. `widget:recent:<username>`, recent listens), with TTLs from `packages/config/src/cache.ts`.
6. **Profile visibility** (public/private) and what "private" hides.
7. **Deleting your account:** what `/account/delete` removes (cascade in migration `007_cascade_user_deletes.sql`) and what may remain (cached copies until TTL expiry, logs until retention ends).
8. **Discord bot:** what it stores, if anything (it binds KV for caching).
9. **Analytics:** the old policy mentions aggregated analytics. Confirm whether any analytics script runs; don't claim analytics that don't exist.
10. **Contact:** `https://elezea.com/contact/`.

Not legal advice; the owner reviews the final text before deploy. The About page's trust bullets must agree with the policy.

## Constraints

- Follow `AGENTS.md`: Hono JSX (not React), no client framework, `// ABOUTME:` headers, 2-space indent, single quotes, semicolons, strict TypeScript.
- Styles go in `apps/web/src/styles/globals.ts`, using the existing CSS variables (`--c-bg`, `--c-accent`, `--c-base` and their `-rgb` forms) so dark mode works.
- Mobile: no horizontal scroll at phone widths.
- Tests: Vitest, handler tests via `app.request()`. Add tests that `/about` renders the three sections and the signed-in/signed-out CTA variants, and that `/privacy` renders. `pnpm typecheck` and `pnpm test` must pass.
- No deploy, no push, no PR. Stop at `pnpm dev` serving the branch on localhost.

## Left to the builder

- Exact grid breakpoints, tile spacing, image aspect ratio.
- Which album page the "Albums and artists" tile links to and shows.
- Screenshot script implementation details.
- Final wording, as long as it stays accurate, first person, and passes the AI-pattern check.
- Whether `/about` gets a more specific `description` meta tag.
