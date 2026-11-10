# lastfm-mcp → ListenToMore: lookup route, tailored sign-in, measurement

*Design, 2026-11-09. Spans three repos: listentomore (this one), lastfm-mcp, elezea.com.*

## Why

lastfm-mcp has about 164 active users a month; ListenToMore has about 5. Every lastfm-mcp user has signed in with Last.fm, because its `/mcp` endpoint sits behind the OAuth provider (`lastfm-mcp/src/index-oauth.ts:145`), and Last.fm is the only sign-in ListenToMore offers. Items 4 and 5 of the adoption assessment (`product-ai: 05-personal/side-projects/listentomore/2026-11-08-seo-aeo-adoption-assessment.md`, section 6) connect the two: a name-based lookup route, then a ListenToMore line in lastfm-mcp's album and artist results.

The person who clicks that line asked their assistant about one specific album or artist. The click must land on that album or artist. Rian's first idea was a separate landing page for MCP visitors with an overview and a big sign-in button; we dropped it because it breaks the link's promise and makes the line read as an ad (OpenAI's app guidelines: apps "must not exist primarily as an advertising vehicle"). The sign-in pitch goes on the album or artist page instead.

## Goals

1. A lastfm-mcp user who clicks the line sees the album or artist they asked about: cover, year, genres, streaming links, and the cached AI summary when one exists.
2. When the visitor came from lastfm-mcp and isn't signed in, the sign-in prompt is written for someone who already uses Last.fm, and signing in brings them back to the same page, where the summary is then generated for them.
3. Rian can see, for any date range, how many clicks came through from lastfm-mcp and how many sign-ups they produced.
4. The 17 old slug links on elezea.com stop returning 404.

## Non-goals

- A separate landing page for MCP visitors.
- Generating AI summaries for logged-out visitors ("Path B"). That decision waits for the Path C review and a spend cap (2026-11-08 decision).
- Changing lastfm-mcp's server instructions or "Next steps" breadcrumbs.
- A ListenToMore MCP server.
- Attribution for other referrers (Discord bot, Discrobble). The design should not rule them out, but only `lastfm-mcp` is wired up now.

## Anti-goals (a failure even if it works)

- The line or the page reads as an ad, or the model is told to show the link.
- A lookup lands on the wrong album or artist. A miss is better than a wrong match.
- Logged-out visitors start getting a cookie from the app, contradicting `/privacy`.
- New data is collected that `/privacy` and `docs/privacy-data-inventory.md` don't describe.
- Crawlers following lookup links cause unbounded Spotify API calls, or bots inflate the click count.

## Part 1: lookup route (listentomore)

**Behaviour.** A public route takes an artist name, optionally an album name, and an optional `ref`. It redirects (302) to `/artist/<spotifyId>` or `/album/<spotifyId>`, carrying `ref` through as a query parameter on the destination.

- **Matching needs its own check; the existing search helpers are not strict enough.** `searchAlbumByArtist` (`packages/services/spotify/src/search.ts:212`) can return a wrong album: `pickBestAlbumMatch` returns a lone result without checking its artist (`search.ts:289`), falls back to other artists' albums when none match (`search.ts:306-307`), and `isAlbumNameMatch` accepts any substring (`search.ts:274`). `searchArtist` (`search.ts:340`) returns Spotify's top hit with no name check. The lookup route may use Spotify search to get candidates, but accepts one only if it passes the route's own check, and changes to the shared helpers must not alter what their existing callers get.
- **What counts as a match** (my call): the artist name must equal the requested artist after normalising case, diacritics, punctuation and a leading "The". For albums, an exact normalised title wins; otherwise a same-artist album whose title matches once edition suffixes are stripped from both sides ("(Deluxe Edition)", "(Remastered 2011)", "- Live" and similar) is accepted, so Last.fm's edition names land on the base album. Anything else is a miss. Tests cover a lone wrong-artist result, a title that is a substring of another title, and an edition-suffixed title.
- **No match:** redirect to the existing search page (`/album?q=<artist> <album>` or `/artist?q=<artist>`), which is already `noindex`.
- **Missing or blank parameters:** 400 or a redirect to search; builder's call.
- **Caching:** cache each name→ID result in the `CACHE` KV namespace, keyed on normalised names, so repeat lookups don't call Spotify. Misses are cached too, for a shorter time. TTLs are the builder's call.
- **Crawlers:** add the lookup path to robots.txt `Disallow` for all user agents (`apps/web/src/robots.ts`). The route itself sends `noindex`.
- **Bots and AI fetchers resolve like people** (my call). A user-triggered fetcher such as Claude-User is acting for the person who asked, so it gets the same redirect. Spotify load is bounded by the robots.txt rule, the KV cache and the zone's existing rate limit; bots are only flagged for measurement (Part 3), not refused.
- **Path and parameter names** are the builder's call. The lastfm-mcp line uses whatever is chosen, so settle it before Part 4.

**Firewall risk, must be tested.** `apps/web/src/pages/album/detail.tsx` notes that names in a query string can trip the zone's firewall, which is why the AI routes take Spotify IDs. This route has to carry names. Before lastfm-mcp links to it, test against production with awkward real titles: apostrophes, quotes, ampersands, slashes, non-Latin scripts, and titles that look like code or SQL (examples to try: `Sigur Rós`, `Hermanos Gutiérrez – Sonido Cósmico`, `i,i`, `Songs: Ohia`, `AC/DC`, `Guns N' Roses`, `"Heroes"`, `SELECT`). If the firewall blocks real titles, stop and bring options to Rian; don't loosen firewall rules without his approval.

## Part 2: tailored sign-in prompt (listentomore)

When the album or artist page is opened with `ref=lastfm-mcp` and the visitor is not signed in, the sign-in prompt uses lastfm-mcp copy.

- **Uncached summary:** the prompt takes the summary slot, where the `SignInGate` would otherwise show. It's prominent: the main thing on the page below the album details.
- **Cached summary:** the summary renders as it does now, and the existing `SignInCTA` below it uses the lastfm-mcp copy.
- **Copy (draft; Rian reviews the wording in the PR):** a heading along the lines of "You already use Last.fm", then what signing in gets them: the AI summary and recommendations for this album (or artist), and their own listening stats. Button: "Sign in with Last.fm". It must not claim anything ListenToMore doesn't do for a new user.
- **Return path:** the button goes to `/login?next=<this page>`, as today, so sign-in returns them to the same album or artist (`pages/auth/lastfm.ts:37-56` already carries `next` through Last.fm).
- **Signed-in visitors** see no prompt and the page behaves as it does now.
- Implement as a new `SignInCTA` variant or a prop on it; builder's call.
- Pages carry canonical tags already, so `?ref=` doesn't create duplicate pages for search engines. Confirm the canonical URL excludes `ref`.

## Part 3: measurement (listentomore)

**Clicks.** Each lookup request with a known `ref` writes one row to a new D1 table (migration 010): timestamp, ref, type (album or artist), matched or not, signed in or not, and a bot flag. No IP address, no raw user agent, no names searched. The bot flag marks requests from known crawlers and AI fetchers (Cloudflare's verified-bot signal where available, plus a user-agent list covering at least Claude-User, ChatGPT-User, Perplexity-User and OAI-SearchBot). Flagged rows are kept and excluded from the human click count. The row write must not slow or break the redirect (use `waitUntil`, and a failed write is logged, not surfaced).

**Sign-ups.** Attribution travels in URLs, not a cookie, so logged-out visitors still get no cookie from the app (`docs/privacy-data-inventory.md` §2 says so, and `/privacy` relies on it):

1. The lookup redirect carries `ref` to the album or artist page.
2. The sign-in button on that page carries it on: `/login?next=<page>&ref=lastfm-mcp`.
3. The Last.fm start handler forwards `ref` on the callback URL, the same way it forwards `next`, accepting only known ref values.
4. The callback, when it creates a new user, stores it in a new `users.signup_ref` column (same migration 010). Returning users and first-time claims of existing accounts don't get one.

Attribution is lost if the visitor browses elsewhere before signing in. That's accepted: the question is whether the page they landed on converts.

**Conversion is a period ratio** (Rian, 2026-11-09): new users with that `signup_ref` ÷ human clicks, both within the same date range. It counts requests, not people: one person clicking twice counts twice, and a click just before the range can produce a sign-up inside it. No click ID or visitor identifier is stored to fix that. The report labels the figure as a request-based ratio.

The Discord new-signup notification includes the ref when there is one (my call; it's a one-line change that tells Rian immediately).

**Reading it.** A script in `apps/web/scripts/` prints, for a date range and ref: lookups, matches and misses, human clicks, bot-flagged requests, new sign-ups with that ref, and conversion (new sign-ups ÷ human clicks). Reads production D1 with `--remote`. The 8-week and 16-week reviews (around 2027-01-03 and 2027-03-01) should be one command.

**Privacy.** In the same change, add the new table, the new column and what writes them to `docs/privacy-data-inventory.md`, and update `/privacy` so it describes them. Every claim on `/privacy` must trace to a row in the inventory (2026-11-08 decision).

## Part 4: lastfm-mcp link line

- In `get_album_info` and `get_artist_info` (`src/mcp/tools/public.ts`), add one plain line after the description and before the "Next steps" block, linking to the lookup route with `ref=lastfm-mcp`. Names are URL-encoded; use the names Last.fm returned (`data.album.name`, the formatted album artist, `data.artist.name`), not the user's input.
- Draft wording: `**ListenToMore:** streaming links and an AI summary for this album → <url>`, and the same for the artist. No instruction to the model to show it.
- Not in "Next steps", not in the server instructions, not in any other tool.
- Update tests for both tools. Follow lastfm-mcp's `AGENTS.md` (tabs, no semicolons, two `ABOUTME` lines, Prettier).
- Ships as a minor release (2.8.0), GitHub only, with `<!-- skip-elezea-post -->`. A merge to `main` deploys production, so this merges only after Parts 1 to 3 are live on listentomore.com and the firewall test has passed.

## Part 5: elezea.com slug links

Seventeen links in two posts (`src/content/posts/my-2024-in-music.md`, `src/content/posts/the-cure-deliver-the-power-doom-epic-weve-been-waiting-for.md`) use the old `listentomore.com/album/<artist>_<album>` form, which now 404s. Resolve each once to its Spotify album ID, check by eye that each is the right album, and rewrite the link to `https://listentomore.com/album/<spotifyId>`. They don't go through the lookup route. Read elezea.com's `CLAUDE.md` before editing and follow its deploy process.

## Constraints

- listentomore: single Worker, no new Workers or services (`AGENTS.md`). Hono JSX, 2-space indent, semicolons, `ABOUTME` headers. Production D1 migrations and deploys are manual from `~/git/listentomore`; confirm deploys with `wrangler deployments list`, since listentomore.com blocks curl and headless Chrome (pages can be read with a `Discordbot` user agent, rate-limited, never `/api/`).
- Nothing here may change Path C's flag behaviour: with `PUBLIC_CACHED_SUMMARIES` off, pages behave as they did before Path C, apart from the tailored copy.
- Inline page scripts already have a known gap where names aren't escaped against `</script>`. Anything new that puts a name or `ref` into an inline script must escape it; fixing the existing gap is out of scope.
- Reviews of the plan and each task use GPT 6 Astra at high effort via T3 `delegate_task` (Rian, 2026-11-09).
- External or production steps (migrations, deploys, PR merges, releases) wait for Rian's go.

## Order

1. listentomore Parts 1–3 on one branch, one PR; migration 010 applied, deployed, firewall test run against production.
2. elezea.com Part 5 (independent; can go any time after step 1 confirms the album pages render).
3. lastfm-mcp Part 4, after step 1 is live.

## Left to the builder

Route path and parameter names, KV key format and TTLs, how the CTA variant is implemented, the bot user-agent list beyond the four named, table and column names, the script's name and output format, and whether artist matching needs an extra name check.
