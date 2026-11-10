# Privacy data inventory

Last verified against the code on 2026-11-08 (branch `about-page-refresh`). Section 1, the cookie rows in sections 2 and 10, the Spotify and Discord rows in section 4, the lookup and Spotify search cache rows in section 5, the `pages/auth/lastfm.ts` citations in sections 6 and 7, and section 11 were re-verified on 2026-11-09 (branch `feat/lastfm-mcp-lookup`); line numbers elsewhere may have drifted. Every row cites the code that produces it. The privacy policy (`apps/web/src/pages/legal/privacy.tsx`) and the About page "what we store" bullets are written from this file, so change this file first when the code changes.

"Unconfirmed" means I could not establish the fact from the repository. Unconfirmed items are kept out of the policy and the About page.

This file records current behavior, including known gaps the policy leaves out until they are fixed: session cleanup, API log retention, the unused session key and `/widget/recent` privacy ([#52](https://github.com/rianvdm/listentomore/issues/52)).

## 1. User columns actually written

Table `users` (`packages/db/src/schema.ts:3`). Writers: `createUser` (`packages/db/src/index.ts:64`), `updateUser` (`packages/db/src/index.ts:98`), called from `apps/web/src/pages/auth/lastfm.ts` and `apps/web/src/pages/account/index.tsx`.

| Column | Written? | Source |
|---|---|---|
| `id` | Yes, random UUID | `pages/auth/lastfm.ts:146` |
| `username` | Yes, lowercased Last.fm username | `pages/auth/lastfm.ts:122,147` |
| `lastfm_username` | Yes, as Last.fm returns it | `pages/auth/lastfm.ts:113,148` |
| `lastfm_session_key` | Yes, on sign-up and refreshed on every sign-in. Stored as received (not hashed or encrypted in code). **Never read anywhere in the repo** (grep for `lastfm_session_key` finds only the two writes), so nothing uses it today | `pages/auth/lastfm.ts:149,206` |
| `display_name` | Yes, defaults to the Last.fm username; user can edit | `pages/auth/lastfm.ts:150,234`; `pages/account/index.tsx:239` |
| `avatar_url` | Yes, the largest image URL from Last.fm `user.getinfo` at sign-up (or at a later sign-in if it was empty) | `pages/auth/lastfm.ts:124-152,211-230` |
| `bio` | Yes, free text the user types on the account page | `pages/account/index.tsx:240` |
| `profile_visibility` | Yes, `public` at sign-up, user can switch to `private` | `pages/auth/lastfm.ts:152`; `pages/account/index.tsx:259` |
| `last_login_at` | Yes, on returning sign-ins only (not set at creation) | `pages/auth/lastfm.ts:207` |
| `login_count` | Yes, 1 at creation, incremented on each sign-in | `packages/db/src/index.ts:76-77`; `pages/auth/lastfm.ts:208` |
| `created_at`, `updated_at` | Yes, database defaults and `updateUser` | `packages/db/src/index.ts:152`; `packages/db/src/migrations/001_initial.sql:11-12` |
| `email` | **Never set.** `updateUser` accepts it but no caller passes it, and no form collects it | `packages/db/src/index.ts:100,105-107`; grep of `updateUser(` callers: `pages/auth/lastfm.ts:237`, `pages/account/index.tsx:238,258` |
| `discogs_username` | **Never set** (same evidence) | `packages/db/src/index.ts:117-119` |
| `spotify_connected` | **Never set** (same evidence) | `packages/db/src/index.ts:121-123` |
| `signup_ref` | Yes, only at account creation and only when the sign-in callback URL carries exactly one `ref=lastfm-mcp` (the only known referrer); otherwise NULL. In practice that needs one path: a `/lookup` that matched, redirecting to an album or artist page with `?ref=lastfm-mcp`, then that page's sign-in button (`SignInCTA`, also inside `SignInGate`), which links to `/login?...&ref=`. A lookup miss redirects to search without `ref` (`pages/lookup.ts:171-172`), the nav's Sign In link goes to `/login` with no `ref` (`components/layout/NavBar.tsx:60`), and moving to any other page drops it, so those sign-ups get NULL. Never updated afterwards, and not set when an existing account is claimed. Removed with the `users` row on deletion | `pages/auth/lastfm.ts:70,153`; `pages/album/detail.tsx:106,179,188,310`; `pages/artist/detail.tsx:86,147,159,353`; `components/ui/SignInCTA.tsx:77-78`; `packages/db/src/index.ts:72,76,88`; `utils/referral.ts:4,14-17`; column added in `packages/db/src/migrations/010_referrals.sql:18` |

Other tables that exist in migrations but have no writer in the app: `discogs_sync_state` and `discogs_releases` (`upsertRelease`, `updateSyncState` are defined in `packages/db/src/index.ts` but have no callers outside the db package; there is no Discogs service in `packages/services/`). `searches` and `recent_searches` were dropped in `packages/db/src/migrations/008_remove_unused_tables.sql`. Whether production D1 still holds old rows in the Discogs tables is **unconfirmed** (the migration `007` cascade covers them if so).

Sign-in flow: the site redirects to Last.fm, Last.fm returns a one-time token, the Worker exchanges it for a session key and username (`pages/auth/lastfm.ts:84-113`). A known `ref` is carried from `/login` through `/auth/lastfm` to the callback in the URL only (`pages/auth/login.tsx:104`; `pages/auth/lastfm.ts:51-55`); no cookie or storage holds it. The site never sees a Last.fm password.

New-signup notification: when `DISCORD_WEBHOOK_URL` is set, a new account (and a first-time claim of an existing account) posts the username and profile URL to the owner's Discord channel (`pages/auth/lastfm.ts:158-202,241-282`). For a new account with `signup_ref` set, the message adds ` (via lastfm-mcp)` after the username (`pages/auth/lastfm.ts:161-165`); the account-claim message has no referrer (`:245-247`). The full payload, including that text, is also written to Workers logs (`:166-171`). That message lives in Discord and is not removed by account deletion.

## 2. Sessions and cookies

| Fact | Source |
|---|---|
| Cookie name `ltm_session`; one cookie, set only at sign-in | `utils/session.ts:9,44` |
| Flags: `Secure`, `HttpOnly`, `SameSite=Lax`, path `/`, max-age 30 days | `utils/session.ts:44-50` |
| Lifetime `SESSION_DURATION` = 30 days (not extended on use; `expires_at` is fixed at creation) | `utils/session.ts:10,33` |
| Token is a random UUID. Only its SHA-256 hash (a one-way hash) is stored | `utils/session.ts:13-21,31-32` |
| Session row stores: id, user id, token hash, user agent, IP address (`CF-Connecting-IP`, falling back to `X-Forwarded-For`), expiry, created and last-active timestamps | `utils/session.ts:35-42`; `packages/db/src/index.ts:165-190`; `schema.ts:20-29` |
| `last_active_at` is updated on each request that validates the cookie | `utils/session.ts:83-86`; `packages/db/src/index.ts:210` |
| Sign out deletes the session row and clears the cookie | `utils/session.ts:94-104`; `pages/auth/lastfm.ts:281-288` |
| An expired session row is deleted when that browser next presents the cookie | `utils/session.ts:76-80` |
| `deleteExpiredSessions` exists but has **no caller** (no scheduled cleanup): expired rows for browsers that never return stay in D1 | `packages/db/src/index.ts:231`; `scheduled()` in `apps/web/src/index.tsx:813-957` does not call it |
| Visitors who never sign in get no cookie from the app, including visitors arriving through `/lookup` or with `?ref=lastfm-mcp` (the referrer travels only in URLs) | grep for `setCookie`/`Set-Cookie`/`document.cookie` in `apps/web/src` (excluding tests) on 2026-11-09: only `utils/session.ts:44`; `git diff 37bf279..HEAD` adds no cookie code |
| Cloudflare, in front of the Worker, sets its own bot-detection cookie `__cf_bm` on responses to every visitor (HttpOnly, Secure, SameSite=None, about 30 minutes), and `cf_clearance` after a visitor passes a security check (challenge). These come from the zone, not the app code | Seen on `curl -sI https://listentomore.com/about` on 2026-11-08; [Cloudflare cookies](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/) |

## 3. API keys and `api_usage_log`

| Fact | Source |
|---|---|
| `api_usage_log` columns: api_key_id, endpoint, method, status_code, ip_address, user_agent, response_time_ms, created_at | `packages/db/src/index.ts:573-600`; `schema.ts:104-114` |
| Written by `apiLoggingMiddleware` for `/api/*` requests, except `/api/internal/*` (the site's own page calls) | `apps/web/src/index.tsx:209`; `middleware/auth.ts:186-216` |
| Every `/api/*` route except `/api/auth/keys` and `/api/internal/*` requires a valid `X-API-Key`; requests without one get a 401 before the logging middleware runs, so no row is written | `apps/web/src/index.tsx:186-198`; `middleware/auth.ts:45-56` |
| So rows come from requests that carry a valid API key, plus owner calls to the admin key-creation route | same |
| IP comes from `CF-Connecting-IP`, then `X-Forwarded-For`, then `X-Real-IP` | `middleware/auth.ts:169-176` |
| API keys can only be created through `POST /api/auth/keys`, which needs the `ADMIN_SECRET` header, and the handler never passes a `userId`. **Signed-in users cannot get an API key** and no key is tied to a user | `apps/web/src/api/admin/keys.ts:19-50`; `packages/db/src/index.ts:431-470` |
| Because keys have no `user_id`, `api_usage_log` rows are not linked to any user account | same |
| Retention: the migration has a comment suggesting a 30-day cleanup, but **no code deletes rows**. Manual cleanup outside the repo is unconfirmed | `packages/db/src/migrations/002_api_keys.sql:74-75` |
| Rate limiting for `/api/*` (not `/api/internal/*`) keeps a KV counter named `ratelimit:user:<API key id or IP>:<minute>`. The IP-keyed `rateLimitMiddleware` in `middleware/security.ts` is defined but not mounted in `index.tsx` (unconfirmed whether anything else mounts it) | `middleware/auth.ts:96-148`; `apps/web/src/index.tsx:202-207` |

## 4. Third parties and the data each receives

Providers and models come from `packages/config/src/ai.ts` (`AI_TASKS`).

| Third party | What it receives | Source |
|---|---|---|
| **Last.fm** (`ws.audioscrobbler.com`, `www.last.fm`) | Sign-in redirect and token exchange. After sign-in, the site calls Last.fm with the member's Last.fm username to fetch top artists, top albums, recent tracks, loved tracks, user info, and per-artist play counts. Requests for public pages also pass the viewed username | `pages/auth/lastfm.ts:55-58,93-95,113`; `packages/services/lastfm/src/top-artists.ts:72,130`, `top-albums.ts:54`, `recent-tracks.ts:41`, `loved-tracks.ts:50`, `user-info.ts:57`, `artist-detail.ts:84,142`; `api/internal/artist.ts:41` |
| **Anthropic** (Claude) | Used for artist/album/genre text, "Ask" answers, and the signed-in insights. See the insights prompt below | `config/src/ai.ts:118-230` |
| **OpenAI** | Only the `randomFact` task (`gpt-5.6-luna`), which has no user input. It is wired up as a switch-back for other tasks but no task uses it for user data today | `config/src/ai.ts:168-180`; `apps/web/src/index.tsx:826-838` |
| **Spotify** | Search text and album/artist ids for catalog lookups, using the site's app credentials (no user is signed in to Spotify; `spotify_connected` is never set). `/lookup` sends the artist name, or artist and album names, as up to three searches on a lookup-cache miss (section 11) | `packages/services/spotify/src/search.ts:127,197-232`, `albums.ts:97`, `artists.ts:62,157,210`, token request `auth.ts:66`; `apps/web/src/pages/lookup.ts:84-104,133-140` |
| **MusicBrainz** | Artist plus album or track names, to look up UPCs and ISRCs | `packages/services/musicbrainz/src/release-lookup.ts:65,137`, `recording-lookup.ts:63,133` (via `fetch.ts:37`) |
| **Apple Music API** | Album or track metadata, to find the Apple Music link | `packages/services/streaming-links/src/providers/apple-music.ts:161`; called from `streaming-links/src/index.ts:208,252,492,564` |
| **YouTube** | **Nothing at runtime.** `YouTubeProvider` is constructed but never called; both result builders hardcode `youtube: null`. The key is only passed to the constructor | `streaming-links/src/index.ts:107,216,260`; `apps/web/src/index.tsx:141` |
| **Songlink/Odesli** | The server only builds the string `https://song.link/<spotify url>` and sends Songlink nothing. When a visitor clicks "More services" (album pages only; there is no track page, `pages/album/detail.tsx:148`), Songlink sees the album's Spotify ID and the visitor's IP address, from the visitor's own browser. `SonglinkService` (the `api.song.link` call at `songlink/src/index.ts:7,64`) is imported only by a test | `streaming-links/src/index.ts:211-212,255-256,597`; `apps/web/src/__tests__/services/songlink.test.ts` |
| **Discord** | The owner's webhook gets username + profile URL on signup, plus ` (via lastfm-mcp)` when `signup_ref` is set (section 1). The Discord bot is a separate Worker (section 8) | `pages/auth/lastfm.ts:158-202` |
| **jsDelivr** (`cdn.jsdelivr.net`) | Every page loads the `marked` script from jsDelivr, so the visitor's browser sends jsDelivr its IP address and user agent | `components/layout/Layout.tsx:71` |
| **Image hosts** | Album art and Last.fm avatars are URLs returned by Spotify and Last.fm, loaded by the visitor's browser from those services' servers; a fallback image loads from `file.elezea.com` | `pages/auth/lastfm.ts:151,224` (avatar URL stored); `packages/services/lastfm/src/top-artists.ts:8` |
| **Cloudflare** | Hosts the Worker, D1 database, KV and Durable Object. Workers Observability logs, traces and Issues are enabled (`[observability]`, `[observability.traces]`, sampling 100%). Retention of those logs and exactly which request fields they hold are **unconfirmed** | `apps/web/wrangler.toml:19-34` |

What the insights prompt sends to Anthropic (`apps/web/src/api/internal/insights.ts:131-162`, `packages/services/ai/src/prompts/user-insights-summary.ts:96-147`, `user-insights-recommendations.ts:69-120`):

- Total plays this week, top 5 artists and top 5 albums for the last 7 days (with play counts), the 30 most recent tracks, and up to 20 top artists from the last 6 months.
- It does **not** send the username, display name, session key, bio, IP address or any account field. The username is only used locally for the cache key and the Last.fm lookup.
- Insights are generated for a public profile when any signed-in user opens it, and for private profiles only when the owner opens it (`insights.ts:19-51`, `requireSessionAuth` on both routes).
- The prompt and answer are not stored on tracing spans for these tasks (`packages/services/ai/src/tracing.ts:10-21`).
- Anthropic's own retention and training terms: **unconfirmed** here, so the policy points to the provider rather than describing them.

The "Ask" feature (`POST /api/v1/ask`, Discord `/ask`) sends the typed question to Anthropic (`listenAi` runs on `claude-sonnet-5-5`), with no account data (`api/v1/ask.ts:18`, `prompts/listen-ai.ts`). `/api/v1/ask` needs an API key, so only the owner can call it.

## 5. KV keys related to a user, and TTLs

All in the `CACHE` namespace. TTLs from `packages/config/src/cache.ts` and `ai.ts` unless noted. `<name>` is the Last.fm or site username.

| Key | Holds | TTL | Source |
|---|---|---|---|
| `widget:recent:<lastfm_username>` | Most recent track (artist, album, track, image, played-at, now-playing flag). Cron writes it for public profiles only; the public `/widget/recent` route also writes it on a cache miss for any username | 7 days | `apps/web/src/index.tsx:764-768,880-888`; `utils/recent-track-cache.ts:16` |
| `user-listens:v2:recent` | Home-page feed of public members' latest tracks (usernames included) | 7 minutes | `apps/web/src/index.tsx:930-941`; `cache.ts:21` |
| `lastfm:topartists:<name>:<period>:<limit>`, `lastfm:topalbums:...` | Top artists/albums | 1 hour | `packages/services/lastfm/src/top-artists.ts:64`, `top-albums.ts:46`; `cache.ts:17-18` |
| `lastfm:lovedtracks:<name>:<limit>` | Loved tracks | 1 hour | `loved-tracks.ts:42`; `cache.ts:20` |
| `lastfm:userInfo:<name>` | Last.fm profile info (avatar, play count) | 30 days | `user-info.ts:47`; `cache.ts:23` |
| `lastfm:artistDetail:<artist>:user:<name>` | Artist info plus that user's play count for the artist | 30 days | `artist-detail.ts:72-74`; `cache.ts:16` |
| `user-recommendations:<name>` | Recommended artists based on the user's top artists | 6 hours | `api/internal/user.ts:71`; `cache.ts:22` |
| `ai:userInsightsSummary:<name>:v3` | The AI weekly summary text | 1 day | `prompts/user-insights-summary.ts:261`; `ai.ts:208-220` |
| `ai:userInsightsRecommendations:<name>` | The four AI album picks | 1 day | `prompts/user-insights-recommendations.ts:160`; `ai.ts:223-228` |
| `insights-refresh:<name>` | Timestamp of the last manual refresh | 5 minutes | `api/internal/insights.ts:58-83`; `cache.ts:27` |
| `lookup:v1:artist:<artist>`, `lookup:v1:album:<artist>\|<album>` (the lookup cache) | Not user-keyed: the result of a `/lookup`, `{ id }` (a Spotify ID) or `{ miss: true }`, keyed on the names normalized by `normalizeName` (lowercase, accents and punctuation removed, `&` as "and", a leading "The" dropped). Written on every lookup that searched Spotify, with or without a `ref`. Keys over 512 bytes are not cached | 30 days (hit), 1 day (miss) | `apps/web/src/pages/lookup.ts:36-42,67-75,132-147`; `utils/lookup-match.ts:87-100`; `cache.ts:47-51` |
| `spotify:search:<type>:<query>` (Spotify search cache) | Not user-keyed: Spotify's results for the query string exactly as received (not normalized or trimmed), including an empty result list. The search pages write it through `/api/internal/search` with the visitor's text, and a `/lookup` miss redirects to `/album?q=<artist> <album>` or `/artist?q=<artist>`, whose page script runs that search, so the looked-up names land here unchanged. Other callers (`api/internal/user.ts:135`, `api/internal/insights.ts:256`, `api/v1/artist.ts:22`) share the key space with artist or album names | 30 days | `packages/services/spotify/src/search.ts:129,182-188`; `cache.ts:9`; `apps/web/src/api/internal/search.ts:9-18`; `pages/album/search.tsx:55,97`; `pages/artist/search.tsx:53,92`; `pages/lookup.ts:171-172` |
| `ratelimit:user:<API key id or IP>:<minute>` | A request counter, only on `/api/*` routes, which need an API key (so IP-keyed only in rare fallbacks) | about a minute | `middleware/auth.ts:109-148` |

Longest-lived user-keyed entry: 30 days (`lastfm:userInfo`, `lastfm:artistDetail:...:user:<name>`).

## 6. What `profile_visibility: 'private'` hides

Hidden from everyone except the owner when signed in:

- The profile page `/u/<name>` (shows a "private profile" page instead): `pages/user/stats.tsx:405-414`.
- `/u/<name>/likes`: `pages/user/likes.tsx:301-306`; `/u/<name>/insights`: `pages/user/insights.tsx:471-476`.
- The internal APIs behind those pages (recommendations, insights): `api/internal/user.ts:31-36`, `api/internal/insights.ts:40-42`.
- The home-page "recent listens" feed and the cron's saved latest track skip private members: `packages/db/src/index.ts:44-53` (`getPublicUsersWithLastfm`), used at `apps/web/src/index.tsx:842`.

Not hidden:

- The private-profile page still shows that the username exists (`PrivateProfile` receives the Last.fm username).
- `GET /widget/recent?username=<name>` is public and fetches the latest track from Last.fm live for any username on a cache miss, with no check of `profile_visibility` (`apps/web/src/index.tsx:722-790`). Whether Last.fm itself withholds recent tracks for users who hide them is unconfirmed, so the policy does not claim it.
- `GET /api/internal/artist-lastfm?name=<artist>` returns a play count only for the signed-in user, read from the session; a `username` query parameter is ignored (`apps/web/src/api/internal/artist.ts`, fixed in [#51](https://github.com/rianvdm/listentomore/issues/51)). Signed-out requests get artist data with no play count.
- Last.fm's own privacy settings are separate and unaffected.
- Default for new accounts is `public` (`pages/auth/lastfm.ts:152`).

## 7. Deleting an account

Handler: `handleAccountDelete` (`pages/account/index.tsx:266-354`), `POST /account/delete`, requires the form value `confirmation=DELETE`. It calls `deleteUserSessions`, then `deleteUser` (`packages/db/src/index.ts:157,237`), then clears the cookie.

Removed from D1:

- The `users` row, including `signup_ref`.
- All `sessions` rows (`ON DELETE CASCADE`: `migrations/006_sessions.sql:6`).
- `api_keys` rows tied to the user (`ON DELETE CASCADE`: `002_api_keys.sql:7`; none exist in practice, see section 3).
- `discogs_sync_state` and `discogs_releases` rows for the user (`migrations/007_cascade_user_deletes.sql`). The cascade depends on D1 enforcing foreign keys, which I did not test.

Remains after deletion:

- KV entries in section 5 until their TTL expires (at most 30 days). Cron stops refreshing the user's `widget:recent:` entry once the row is gone.
- `api_usage_log` rows: not linked to users (section 3), and `ON DELETE SET NULL` on the key reference (`002_api_keys.sql:38`).
- Workers logs: the handler logs `user_id`, `username`, `lastfm_username` at start, and sign-in logs the username and Last.fm name (`pages/account/index.tsx:295-323`; `pages/auth/lastfm.ts:156,239`). These stay until Cloudflare's log retention ends (period unconfirmed).
- The Discord signup notification (section 1), including ` (via lastfm-mcp)` if it had one.
- `referral_clicks` rows: they have no user reference (section 11).
- Anything Last.fm, Anthropic, Spotify or other providers keep on their side.
- Deleting does not revoke the site's authorization on the user's Last.fm account (the site has no call to do so). The user can remove it in their Last.fm settings.

The account page text says deletion removes the account and all sessions, and links to `/privacy` for what remains (`pages/account/index.tsx:158-162`).

## 8. Discord bot (`apps/discord-bot`)

| Fact | Source |
|---|---|
| Separate Worker `listentomore-discord-bot` with a `CACHE` KV binding and observability enabled. **No D1 binding**: it stores no per-user rows | `apps/discord-bot/wrangler.toml` |
| KV is used only by the Spotify, streaming-links and AI services for catalog and AI-text caching (same cache keys as the site). The Last.fm service is created with no cache, so Last.fm listening data is never cached by the bot | `apps/discord-bot/src/index.ts:50-84` |
| `/listenlast <lastfm username>` looks up the typed Last.fm user's most recent track and posts it publicly in the channel | `commands/listenlast.ts:28-48` |
| `/ask <question>` sends the question to Anthropic and posts the answer and question publicly | `commands/ask.ts:26-48` |
| `/listento`, `/listenurl`, `/whois`, `/whatis` take music names or URLs | `whois.ts:37`, `whatis.ts:40`, `listento.ts:76`, `listenurl.ts:68` |
| Error logging writes error objects, not interaction content | `ask.ts:48`, `listento.ts:115`, `listenlast.ts:53`, `listenurl.ts:103`, `whois.ts:51`, `whatis.ts:80` |
| Whether Discord user ids or interaction tokens appear in Workers logs: unconfirmed | n/a |

## 9. Analytics scripts

- No analytics, tag manager, pixel or tracking script is loaded anywhere in `apps/web/src` or `apps/web/public`. The only external `<script src>` is `marked` from jsDelivr (`components/layout/Layout.tsx:71`).
- The app sets no cookie other than `ltm_session`. Cloudflare's `__cf_bm` and `cf_clearance` come from the zone (section 2).
- The old policy's "aggregated analytics" claim is not supported by the code. Usage figures come from Cloudflare's own dashboards and Workers Observability, which are infrastructure-level. Whether the Cloudflare zone has Web Analytics (a dashboard setting that injects a beacon at the edge) turned on is **unconfirmed**: nothing in the repo shows it, and I did not inspect the zone.
- Social-crawler requests (LinkedInBot, Slackbot, Discordbot and similar) are logged with user agent, path, referer and `CF-Connecting-IP` to the Worker's console (`middleware/crawler-logging.ts:17-47`).

## 10. `localStorage` and cookies

| Key | Purpose | Source |
|---|---|---|
| `localStorage.theme` | Light or dark choice, only after the user clicks the toggle | `Layout.tsx:79,176` |
| `localStorage['banner-dismissed-<id>']` | Remembers a dismissed announcement banner | `Layout.tsx:140-152` |
| Cookie `ltm_session` | Sign-in session, only for signed-in users | `utils/session.ts:44` |
| Cookies `__cf_bm`, `cf_clearance` | Set by Cloudflare, not the app: bot detection on every visitor, and a passed security check | Section 2; [Cloudflare cookies](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/) |

Nothing else uses `localStorage`, `sessionStorage` or `document.cookie` in `apps/web/src`. Page loads embed `window.__INTERNAL_TOKEN__`, a 5-minute HMAC token with only issued-at and expiry times, no user or IP data (`utils/internal-token.ts:1-35`).

## 11. Referral clicks (`referral_clicks`) and `/lookup`

`GET /lookup?artist=<name>[&album=<name>][&ref=<ref>]` is the link lastfm-mcp uses. It redirects to an album or artist page, or to the search page (`apps/web/src/pages/lookup.ts:110-173`; route at `apps/web/src/index.tsx:657`). `robots.txt` disallows it (`apps/web/src/robots.ts:27`).

| Fact | Source |
|---|---|
| Table columns: `id`, `ref`, `type` (`album` or `artist`), `matched`, `signed_in`, `is_bot`, `created_at`. No user id, IP address, user agent or searched name | `packages/db/src/migrations/010_referrals.sql:6-14` |
| One row per `/lookup` request that carries exactly one known `ref` (only `lastfm-mcp`); unknown or repeated `ref` values write nothing. Requests rejected with 400 (missing or over-long names) write nothing | `pages/lookup.ts:117-123,153-166`; `utils/referral.ts:4,8-17` |
| Written by `recordReferralClick` with `ref`, `type`, `matched` (a Spotify ID was found), `signed_in` (a session user was present) and `is_bot`; `created_at` is the database default | `packages/db/src/index.ts:635-654`; `pages/lookup.ts:157-163` |
| `is_bot` is computed from the user agent and Cloudflare's verified-bot flag at request time; neither value is stored | `utils/referral.ts:26-33`; `pages/lookup.ts:155,162` |
| Rows are not linked to accounts, so account deletion leaves them. No code deletes rows (no retention job) | migration above; `pages/account/index.tsx:266-354` |
| The only reader is the owner's report script, which counts clicks per referrer and day range and counts `users.signup_ref` sign-ups, reading production D1 with `wrangler d1 execute --remote` | `apps/web/scripts/referral-report.ts:1-2`; `referral-report-lib.ts:32-50` |
| The artist and album names never go into `referral_clicks`. They go into the lookup KV cache (section 5) and, on a cache miss, to Spotify search (section 4). On a miss the redirect to the search page puts them, unnormalized, into the Spotify search cache for 30 days (section 5) | `pages/lookup.ts:132-147,171-172` |
| Logs: `lookup.ts` logs only error messages, not names (`:54,143`; deferred-write failures through `packages/shared/src/utils/defer.ts:21-22`). The Spotify search logs the query, which contains the names, when Spotify returns 429. The request URL holds the names too; which request fields Workers logs keep is unconfirmed (section 4, Cloudflare row) | `packages/services/spotify/src/search.ts:236-239`; `apps/web/wrangler.toml:19-34` |
| The redirect to an album or artist page after a match keeps `?ref=lastfm-mcp` in the URL only, so that page's sign-in button can carry it to `/login` and the sign-in callback (section 1). The redirect to search after a miss drops it | `pages/lookup.ts:168-172`; `pages/album/detail.tsx:310`; `components/ui/SignInCTA.tsx:77-78` |
