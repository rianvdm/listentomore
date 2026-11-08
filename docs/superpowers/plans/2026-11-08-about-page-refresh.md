# About Page Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/about` with a three-section page (features with real screenshots, signing in, how it's built) and rewrite `/privacy` so it matches what the code stores.

**Architecture:** Both pages stay server-rendered Hono JSX components rendered from `apps/web/src/index.tsx` (routes unchanged). A data inventory doc grounds every privacy claim in code. Screenshots are WebP files in `apps/web/public/images/about/`, produced by a repeatable Node script that drives headless Chrome over CDP against the local dev server.

**Tech Stack:** TypeScript (strict), Hono JSX, Cloudflare Workers + Workers Static Assets, Vitest, Node 22 (global `WebSocket`), Google Chrome headless.

**Spec:** `docs/superpowers/specs/2026-11-08-about-page-refresh-design.md`

## Global Constraints

- Follow `AGENTS.md`: `// ABOUTME:` 2-line header on new files, 2-space indent, single quotes, semicolons, `import type` for types.
- Tests are `src/**/*.test.ts` (no `.tsx`); render components with `Component(props).toString()` like `src/__tests__/components/ui/sign-in-cta.test.ts`.
- Styles go in `apps/web/src/styles/globals.ts` using `--c-bg`, `--c-accent`, `--c-base` and their `-rgb` forms. No hardcoded colors, so dark mode works.
- No horizontal scroll at 375px wide.
- Copy: first person ("I"), plain English, no claim the code doesn't support. Check against `~/git/product-ai/01-context/avoid-ai-patterns.md`. No em dashes in page copy.
- Screenshots show only real UI and only the owner's data (Last.fm user `bordesak`).
- Do not deploy, push, or open a PR.
- `pnpm typecheck` and `pnpm --filter @listentomore/web test` pass after every task.

## Review Focus

1. Dark mode (`prefers-color-scheme: dark` and the site's theme toggle): tile borders, text and the sign-in button stay legible. Task 2 styles use only CSS variables; reviewer checks in both themes.
2. Phone width (375px): grid drops to fewer columns, images scale down, no horizontal scroll. Task 2 adds the breakpoint; Task 4 checks it.
3. Signed-in visitor, including one whose `lastfm_username` is null: no sign-in button, a working link instead. Task 2 test `signed-in user without lastfm_username links to /account`.
4. Images missing or slow: every `<img>` has `width`, `height`, `alt` and `loading="lazy"`, and every referenced file exists. Task 2 test asserts attributes; Task 3 test asserts files exist.
5. About and privacy disagree: the About page's stored-data bullets must be backed by the privacy policy. Task 1 inventory is the single source; Task 2 test `trust bullets match privacy policy terms`.

---

### Task 1: Data inventory and privacy policy rewrite

**Files:**
- Create: `docs/privacy-data-inventory.md`
- Modify: `apps/web/src/pages/legal/privacy.tsx`
- Test: `apps/web/src/__tests__/pages/privacy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/privacy-data-inventory.md`, the list Task 2 copies its trust bullets from. `PrivacyPage({ currentUser }: { currentUser?: User | null })` keeps its signature (route at `apps/web/src/index.tsx:717` unchanged). Export `PRIVACY_EFFECTIVE_DATE = 'November 8, 2026'` from `privacy.tsx`.

- [ ] **Step 1: Build the inventory.** Read the code and write `docs/privacy-data-inventory.md`, one table per category, each row citing `file:line`. Categories, from spec section "Privacy policy rewrite" items 1-9: user columns actually written (`packages/db/src/index.ts`, `apps/web/src/pages/auth/lastfm.ts`, `apps/web/src/pages/account/index.tsx`; confirm whether `email`, `discogs_username`, `spotify_connected` are ever set), sessions (`apps/web/src/utils/session.ts`, `SESSION_DURATION`), `api_usage_log` (`packages/db/src/index.ts:584`, and whether non-owner users can get API keys), third parties and the exact data each receives (trace what the insights prompt sends to the AI provider in `packages/services/ai/`), user-related KV keys and TTLs (`packages/config/src/cache.ts`, `widget:recent:<username>` in `apps/web/src/index.tsx`), what `profile_visibility: 'private'` hides, what account deletion removes (`packages/db/src/migrations/007_cascade_user_deletes.sql`, `/account/delete` handler) and what remains, Discord bot storage (`apps/discord-bot/src`), analytics scripts (grep `apps/web/src` for any third-party script tags), cookies and `localStorage` use. Mark anything unconfirmed as "unconfirmed" rather than guessing.

- [ ] **Step 2: Write the failing test** in `apps/web/src/__tests__/pages/privacy.test.ts`:

```typescript
import { PrivacyPage, PRIVACY_EFFECTIVE_DATE } from '../../pages/legal/privacy';

describe('PrivacyPage', () => {
  const html = PrivacyPage({ currentUser: null }).toString();

  it('drops the claim that no personal information is collected', () => {
    expect(html).not.toContain('do not collect any personally identifiable information');
  });

  it('shows the new effective date', () => {
    expect(PRIVACY_EFFECTIVE_DATE).toBe('November 8, 2026');
    expect(html).toContain(PRIVACY_EFFECTIVE_DATE);
  });

  it('names what sign-in stores', () => {
    expect(html).toContain('Last.fm username');
    expect(html).toContain('IP address');
    expect(html).toContain('session key');
  });

  it('explains deletion and links to the account page', () => {
    expect(html).toContain('href="/account"');
  });
});
```

- [ ] **Step 3: Run it to verify it fails.** `pnpm --filter @listentomore/web exec vitest run src/__tests__/pages/privacy.test.ts`. Expected: FAIL (`PRIVACY_EFFECTIVE_DATE` undefined, old claim present).

- [ ] **Step 4: Rewrite `privacy.tsx`** from the inventory. Sections, in order: what I store when you sign in; sessions and cookies; who else gets your data (one short paragraph per third party, saying what it receives); caching; private profiles; deleting your account (link `/account`, say what lingers and for how long); the Discord bot; analytics (state what's true); changes to this policy; contact (`https://elezea.com/contact/`). Keep the `Layout` wrapper and existing page markup conventions. Every claim must trace to an inventory row; omit anything marked unconfirmed, and list those in your report.

- [ ] **Step 5: Run the test to verify it passes**, then `pnpm typecheck`. Expected: PASS, no type errors.

- [ ] **Step 6: Commit.**

```bash
git add docs/privacy-data-inventory.md apps/web/src/pages/legal/privacy.tsx apps/web/src/__tests__/pages/privacy.test.ts
git commit -m "Rewrite the privacy policy to match what the site stores"
```

---

### Task 2: About page

**Files:**
- Modify: `apps/web/src/pages/about/index.tsx`
- Modify: `apps/web/src/styles/globals.ts` (append an `/* About page */` block, `.about-` class prefix)
- Test: `apps/web/src/__tests__/pages/about.test.ts`

**Interfaces:**
- Consumes: `docs/privacy-data-inventory.md` (Task 1) for the trust bullets.
- Produces: `AboutPage({ currentUser }: { currentUser?: User | null })` (route at `apps/web/src/index.tsx:714` unchanged); exported `ABOUT_FEATURES: readonly AboutFeature[]` where `interface AboutFeature { slug: 'album' | 'genre' | 'listening' | 'profile' | 'discord' | 'mcp'; title: string; description: string; href: string; alt: string }`. Image path is derived: `/images/about/${slug}.webp`, rendered at `width="1200" height="750"`. Task 3 must produce exactly these six files.

- [ ] **Step 1: Write the failing tests** in `apps/web/src/__tests__/pages/about.test.ts`. Build users from the `mockUser` shape in `src/__tests__/handlers/account.test.ts`.

```typescript
import { AboutPage, ABOUT_FEATURES } from '../../pages/about';
import { PrivacyPage } from '../../pages/legal/privacy';

// Same fields as mockUser in account.test.ts, cast to User.
const user = { id: 'user-123', username: 'testuser', lastfm_username: 'testuser', display_name: 'Test User', bio: null, profile_visibility: 'public', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' } as unknown as User;

describe('AboutPage', () => {
  const signedOut = AboutPage({ currentUser: null }).toString();

  it('renders the three sections', () => {
    expect(signedOut).toContain('What you can do here');
    expect(signedOut).toContain('Signing in');
    expect(signedOut).toContain("How it's built"); // match the escaping Hono emits
  });

  it('renders six feature tiles with sized, lazy, described screenshots', () => {
    expect(ABOUT_FEATURES.map((f) => f.slug)).toEqual(['album', 'genre', 'listening', 'profile', 'discord', 'mcp']);
    for (const f of ABOUT_FEATURES) {
      expect(signedOut).toContain(`src="/images/about/${f.slug}.webp"`);
      expect(f.alt.length).toBeGreaterThan(10);
    }
    expect(signedOut.match(/loading="lazy"/g)).toHaveLength(6);
    expect(signedOut.match(/width="1200" height="750"/g)).toHaveLength(6);
  });

  it('shows the sign-in button to signed-out visitors', () => {
    expect(signedOut).toContain('href="/login?next=%2Fabout"');
  });

  it('links signed-in users to their profile instead', () => {
    const html = AboutPage({ currentUser: { ...user, lastfm_username: 'testuser' } }).toString();
    expect(html).not.toContain('/login?next=');
    expect(html).toContain('href="/u/testuser"');
  });

  it('signed-in user without lastfm_username links to /account', () => {
    const html = AboutPage({ currentUser: { ...user, lastfm_username: null } }).toString();
    expect(html).toContain('href="/account"');
    expect(html).not.toContain('/login?next=');
  });

  it('trust bullets match privacy policy terms', () => {
    const privacy = PrivacyPage({ currentUser: null }).toString();
    for (const term of ['Last.fm username', 'IP address', 'one-way hash']) {
      expect(signedOut).toContain(term);
      expect(privacy).toContain(term);
    }
  });

  it('opens external stack links in a new tab safely', () => {
    const external = signedOut.match(/<a [^>]*href="https:[^"]*"[^>]*>/g) ?? [];
    expect(external.length).toBeGreaterThan(8);
    for (const tag of external) expect(tag).toContain('rel="noopener noreferrer"');
  });
});
```

If `one-way hash` isn't in Task 1's privacy copy, add it there in this task rather than weakening the test.

- [ ] **Step 2: Run to verify it fails.** `pnpm --filter @listentomore/web exec vitest run src/__tests__/pages/about.test.ts`. Expected: FAIL (`ABOUT_FEATURES` undefined).

- [ ] **Step 3: Implement the page.** Structure and draft copy are in the spec's "The About page" section; use them, correcting any sentence the code contradicts (check the streaming services the album page links, what the cron does, which AI tasks run on OpenAI vs Claude in `packages/config/src/ai.ts`). Tile data from the spec's tile table; `album` tile links to a real album page of your choice; `profile` and `listening` link to `/u/bordesak` and `/stats`. Signing-in section: plain prose plus bullets, no border or background. Button reuses the site's `.button` class. "How it's built" links: Workers `https://developers.cloudflare.com/workers/`, Hono `https://hono.dev/`, D1 `https://developers.cloudflare.com/d1/`, Workers KV `https://developers.cloudflare.com/kv/`, Durable Objects `https://developers.cloudflare.com/durable-objects/`, Cron Triggers `https://developers.cloudflare.com/workers/configuration/cron-triggers/`, Spotify Web API `https://developer.spotify.com/documentation/web-api`, MusicBrainz `https://musicbrainz.org/doc/MusicBrainz_API`, Last.fm API `https://www.last.fm/api`, Songlink `https://odesli.co/`, Claude `https://www.anthropic.com/claude`, plus the three elezea/GitHub links from the spec. Add others (OpenAI, Workers Observability) only if the copy mentions them. Set a specific `description` on `Layout`.

- [ ] **Step 4: Add styles** to `globals.ts`: `.about-lede`, `.about-grid` (3 columns, 2 at `max-width: 768px`, 1 at `max-width: 480px`), `.about-tile` (border `1px solid rgba(var(--c-base-rgb), 0.12)`, radius, overflow hidden), `.about-tile img` (`display:block; width:100%; height:auto`), `.about-cta` (centered). Follow existing media-query style in the file.

- [ ] **Step 5: Run the tests, the full web suite, and typecheck.** Expected: all PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/pages/about/index.tsx apps/web/src/styles/globals.ts apps/web/src/__tests__/pages/about.test.ts
git commit -m "Rewrite the About page around features, sign-in and the stack"
```

---

### Task 3: Screenshot script and images

**Files:**
- Create: `apps/web/scripts/about-shots.mjs`
- Modify: `apps/web/package.json` (add `"about-shots": "node scripts/about-shots.mjs"`)
- Create: `apps/web/public/images/about/{album,genre,listening,profile,discord,mcp}.webp`
- Test: `apps/web/src/__tests__/pages/about-images.test.ts`

**Interfaces:**
- Consumes: `ABOUT_FEATURES` slugs and hrefs from Task 2 (the script keeps its own slug-to-URL map; it can't import TSX).
- Produces: six WebP files, 1200x750.

Production serves a Cloudflare bot challenge to headless Chrome (checked 2026-11-08), so the script targets the local dev server: `BASE_URL` env var, default `http://localhost:8787`.

- [ ] **Step 1: Write the failing test** `about-images.test.ts`: for each `ABOUT_FEATURES` slug, `fs.existsSync(path.join(__dirname, '../../../public/images/about', `${slug}.webp`))` is true and the file is over 10 KB and under 300 KB.

- [ ] **Step 2: Run to verify it fails.** Expected: FAIL (files missing).

- [ ] **Step 3: Write `about-shots.mjs`.** Launch `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (overridable via `CHROME_PATH`) with `--headless=new --remote-debugging-port=<free port> --user-data-dir=<temp dir>`, read the WebSocket URL from `http://127.0.0.1:<port>/json/version`, drive CDP with Node 22's global `WebSocket`. Per shot: `Emulation.setDeviceMetricsOverride` 1200x750 at `deviceScaleFactor: 1`, `Emulation.setEmulatedMedia` with `prefers-color-scheme: light`, `Page.navigate`, wait for `Page.loadEventFired` plus a settle delay for progressive loads, `Page.captureScreenshot` with `format: 'webp', quality: 80`, `captureBeyondViewport: false`. Fail loudly (non-zero exit) if the page title contains "Attention Required" or the response status is not 200. Kill Chrome and remove the temp dir in `finally`. URLs per slug: `album` and `genre` the pages Task 2 links to; `listening` and `profile` `/u/bordesak` captured at two different scroll offsets (stats section vs header) so the tiles differ; `discord` `/discord`; `mcp` `/tools`. Header comment explains the local-D1 setup below and how to rerun.

- [ ] **Step 4: Prepare local dev.** `pnpm --filter @listentomore/web exec wrangler d1 migrations apply DB --local`, then insert a local-only public user row for `bordesak` via `wrangler d1 execute DB --local --command "INSERT ..."` with the columns from `packages/db/src/schema.ts`. Never use `--remote`. Start `pnpm dev` in the background.

- [ ] **Step 5: Run `pnpm --filter @listentomore/web run about-shots`.** Then open each of the six images (view them) and confirm real page content: no error pages, no empty loading states, no challenge pages, no other user's data. Re-run with a longer settle delay or different scroll offset if any shot is wrong.

- [ ] **Step 6: Run the image test and full suite.** Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/web/scripts/about-shots.mjs apps/web/package.json apps/web/public/images/about apps/web/src/__tests__/pages/about-images.test.ts
git commit -m "Add About page screenshots and the script that captures them"
```

---

### Task 4: Final check on localhost (controller)

- [ ] `pnpm typecheck` and `pnpm test` from the repo root. Expected: PASS.
- [ ] With `pnpm dev` running, load `http://localhost:8787/about` and `/privacy` in headless Chrome at 1200px and 375px (CDP device emulation), light and dark. Confirm no horizontal scroll, images load, CTA shows.
- [ ] Copy pass: run the About and privacy copy against `avoid-ai-patterns.md`.
- [ ] Whole-branch review, then leave `pnpm dev` running for the owner.
