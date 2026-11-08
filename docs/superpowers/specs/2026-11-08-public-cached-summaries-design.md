# Design: Public cached AI summaries (Path C test)

**Date:** 2026-11-08
**Status:** Draft for owner approval
**Branch:** `feat/public-cached-summaries`
**Background:** the owner's SEO and agent-access assessment (`product-ai/05-personal/side-projects/listentomore/2026-11-08-seo-aeo-adoption-assessment.md`), which recommended this as a time-boxed test.

## Why

Search engines and AI assistants can only cite text that is public and in the page HTML. ListenToMore's most distinctive text, the AI album, artist and genre summaries, has been behind Last.fm sign-in since v1.5.0, because every summary costs an Opus call (`docs/feature-gating.md`: "Gated (AI-powered, costly)"). Logged out, an album page shows about 80 words and a sign-in prompt, so there is nothing to index.

About 100 summaries are already in the cache, paid for by signed-in visitors. Showing those to everyone costs nothing new. If those pages earn search impressions and don't cost sign-ups, opening more pages (with a spending cap) becomes a measured decision instead of a guess.

## What success looks like

The test runs 16 weeks from deploy, with checks at 8 and 16 weeks:

- **Search Console** shows impressions, and ideally clicks, for the published album, artist and genre URLs.
- **Weekly sign-ups** (the D1 `users.created_at` count) stay at or above the baseline: 3 in the 30 days before 2026-11-08, 10 in the 90 days before.
- **No new model spend from anonymous traffic.** Calls for the four affected tasks (`albumDetail`, `artistSummary`, `genreSummary`, `albumRecommendations`) don't rise with logged-out visits. The home page's artist sentence is already public and generated for anonymous visitors; it is out of scope and excluded from this measure.

If sign-ups fall below baseline, the owner reverts. The test is too small to prove a lift, so a flat result with growing impressions counts as a pass.

## Goals

1. When a summary for an album, artist or genre is already cached, render it in the page HTML for every visitor, signed in or not. For albums, also render the cached album recommendations.
2. When nothing is cached, logged-out visitors see today's data-only page with a sign-in prompt, and **no model call is made**. Signed-in visitors keep today's behaviour: the summary is generated and loaded progressively.
3. Label each public summary with a one-line "AI-written summary" note that links to the About page's "How it's built" section.
4. Rewrite the logged-out sign-in prompt on pages that now show a summary. It sits below the summary and pitches what is still personal: your stats, insights, and picks based on what you play.
5. Publish `/sitemap.xml` listing exactly the album and artist pages whose summary is cached, plus curated genres (`isCuratedGenre`) whose summary is cached, with `lastmod` set to when the summary was written, and restore the `Sitemap:` line in robots.txt. Genres outside the curated list keep their `noindex` tag and stay out of the sitemap even when a summary exists: the cache holds junk genre names typed in by users.
6. Before launch, audit every cached summary and delete any that are truncated, empty or junk, so they regenerate on the next signed-in view. Re-write each approved summary with a fresh expiry for its task's TTL, so the published set lasts through the 16-week test instead of expiring partway (album summaries live 120 days). Album recommendations keep their 30-day TTL and are expected to thin out; the test is judged on summaries.

## Non-goals

- Generating summaries for anonymous visitors on a cache miss (that is "Path B", deferred until this test shows demand).
- Server-rendering similar artists, popular albums or other JavaScript-loaded sections, or adding entity links to the homepage. Those are separate follow-ups.
- A name-based lookup route, structured data, or lastfm-mcp changes.
- Changing what is personal: user insights, recommendations based on listening, and profiles keep their current gating.
- Deploying without the owner's go.

## Anti-goals (failure even if it "works")

- **Any code path where an anonymous request triggers a summary or recommendation model call** for the four tasks above. This must be enforced in code and covered by a test, not left to the client script.
- A sign-in prompt that still promises to "unlock AI summaries" on a page that already shows one.
- Publishing a summary that is visibly broken (cut off mid-sentence, an error string, "Not enough information available").
- A sitemap that lists pages without a cached summary, or that sets `lastmod` to the request time.

## Constraints

- Single Worker, Hono JSX server rendering, no client framework (`AGENTS.md`).
- Cache reads must use the same key normalization as the writers. Today each prompt module lowercases and trims names before calling `AICache.get` (for example `packages/services/ai/src/prompts/album-detail.ts`). Add read-only methods to `AIService` that reuse that normalization, rather than building keys in the web app.
- The cached value holds only `content` (and optional `metadata`). There is no model or write-date field. The write date is the KV expiration minus the task's TTL.
- Never cache an AI response without `isCacheableResponse()`. This design generates no new AI text; the only KV writes are the one-time expiry refresh of audited entries.
- `/api/internal/*` AI routes keep `requireSessionAuth`. Server rendering reads the cache directly instead of opening those routes.
- Markdown is rendered client-side today with an unversioned `marked` from a CDN (`Layout.tsx`). Server rendering needs a pinned server-side Markdown renderer, and its output must match what users see today closely enough that the switch isn't noticeable.

## Decided by the owner

- Publish **all** cached summaries after an audit, not only those written by Claude since 2026-10-25.
- A small "AI-written summary" label linking to About's "How it's built" section; no separate methodology page.
- The logged-out prompt moves below the summary and pitches personal features.
- Keep blocking AI training crawlers; search and user-triggered AI fetchers are allowed (shipped 2026-11-08 in `0b4a2cf`).

## Decided by the builder (owner may override)

- **Sitemap index in D1.** Cache keys are names (`ai:albumDetail:<artist>:<album>`) but page URLs use Spotify IDs, so the sitemap can't be built from KV alone. Add a D1 table recording, for each cached summary, the entity type, the page path (`/album/<spotifyId>`, `/artist/<spotifyId>`, `/genre/<slug>`), when it was written and when it expires. Write a row whenever an album, artist or genre summary is cached from a page view (the internal routes and page handlers know the Spotify ID). The sitemap is one `SELECT` of unexpired rows.
- **Backfill.** A one-time script maps the existing cached entries to pages: genres from the key, albums and artists by Spotify search on the cached names, keeping only exact name matches and logging the rest. Unmatched entries stay public on their pages but are left out of the sitemap.
- **Signed-in visitors get the server-rendered summary too** when it's cached, so the page is faster and identical for everyone; the progressive client fetch runs only on a miss.
- **Recommendations' links** keep today's client-side enrichment; server-rendered recommendation links may point at search URLs, which are already `noindex`.
- **The audit** is a script under `apps/web/scripts/` that reads every cached album, artist, genre and recommendation entry, flags likely truncation (no closing punctuation, unbalanced Markdown, under a length floor), error strings and "Not enough information available", prints a report for the owner, and deletes only entries the owner approves.

## Left to the builder

Component structure, the exact label and prompt copy (within the decisions above), the D1 migration name and columns, the Markdown library choice, the length floor for the audit, and test layout. Follow the repo's TDD and `ABOUTME` conventions.

## Measurement and rollout

1. Run the audit, get the owner's approval on deletions, run the backfill.
2. Deploy, submit the sitemap in Search Console and Bing Webmaster Tools.
3. Record the launch date and the number of published URLs. At 8 and 16 weeks, compare Search Console impressions for the published URLs and weekly sign-ups against the baseline above, and check AI call volume in Workers Observability.
4. Revert path: one flag turns public rendering off and restores today's gating. Flipping it is a one-line config change and a deploy, with no code to revert. (Builder: a `wrangler.toml` var or a `packages/config` constant is fine.)
