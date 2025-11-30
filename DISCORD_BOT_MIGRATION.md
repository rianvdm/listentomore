# Discord Bot Migration

> **Goal:** Port the Discord bot from `cloudflare-workers/discord-listen-bot` to `apps/discord-bot` using the new services architecture, without re-registering the bot.

## Current State

**Old bot location:** `/Users/rian/Documents/GitHub/cloudflare-workers/discord-listen-bot`
**Old bot URL:** `https://discord-listen-bot.rian-db8.workers.dev`

**Discord Application:**
- Application ID: `1284593290947068024`
- Public Key: `140b424d4a117e866ac92e70625e06e75f85636ef76c1fd0b106f898b3128353`

## Commands to Port

| Command | Description | Services Used | Status |
|---------|-------------|---------------|--------|
| `/listento` | Get album details by name/artist | Spotify, Songlink, AI (artist sentence) | ✅ Done |
| `/listenlast` | Get Last.fm user's recent album | Last.fm, Spotify, Songlink, AI | ✅ Done |
| `/listenurl` | Get streaming links for a URL | Songlink, Spotify, AI | ✅ Done |
| `/whois` | Get artist info | AI (artist sentence) | ✅ Done |
| `/whatis` | Get genre info | AI (genre summary) | ✅ Done |
| `/ask` | Ask Rick Rubin AI | AI (listen-ai) | ✅ Done |

## Services Available (Already Implemented)

All services exist in `packages/services/`:
- `SpotifyService` - search, album/artist details
- `LastfmService` - recent tracks, top artists/albums
- `SonglinkService` - cross-platform streaming links
- `AIService` - artist sentence, genre summary, listen-ai (Rick Rubin)

## Secrets Strategy

**Local development:** `apps/discord-bot/.dev.vars`
```bash
DISCORD_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_PUBLIC_KEY=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REFRESH_TOKEN=
LASTFM_API_KEY=
OPENAI_API_KEY=
PERPLEXITY_API_KEY=
```

**Production:** Use `wrangler secret put` for each secret
```bash
cd apps/discord-bot
wrangler secret put DISCORD_TOKEN
wrangler secret put DISCORD_APPLICATION_ID
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put SPOTIFY_CLIENT_ID
wrangler secret put SPOTIFY_CLIENT_SECRET
wrangler secret put SPOTIFY_REFRESH_TOKEN
wrangler secret put LASTFM_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put PERPLEXITY_API_KEY
```

## Migration Checklist

### Phase 1: Setup ✅
- [x] Create `apps/discord-bot/` directory structure
- [x] Set up `package.json` with dependencies
- [x] Set up `wrangler.toml` (NO secrets, just config)
- [x] Set up `tsconfig.json`

### Phase 2: Core Infrastructure ✅
- [x] Port `verify.ts` - Ed25519 signature verification
- [x] Port `discord.ts` - Discord API helpers
- [x] Port `format.ts` - URL/name formatting utils
- [x] Create main `index.ts` with routing and service initialization
- [x] Add command registration endpoint (`/register-commands`)

### Phase 3: Port Commands ✅
- [x] `/listento` - album lookup
- [x] `/listenlast` - Last.fm recent album
- [x] `/listenurl` - URL streaming links
- [x] `/whois` - artist info
- [x] `/whatis` - genre info
- [x] `/ask` - Rick Rubin AI

### Phase 4: Deploy & Cutover ✅
- [x] Deploy to Cloudflare Workers
- [x] Add all secrets via `wrangler secret put`
- [x] Update Discord Developer Portal: Interactions Endpoint URL
- [x] Verify commands work
- [x] Switch listentomore.com to new web app

## File Structure

```
apps/discord-bot/
├── src/
│   ├── index.ts              # Main entry, routing, service init
│   ├── types.ts              # Discord interaction types
│   ├── register.ts           # Command registration
│   ├── commands/
│   │   ├── listento.ts       # /listento command
│   │   ├── listenlast.ts     # /listenlast command
│   │   ├── listenurl.ts      # /listenurl command
│   │   ├── whois.ts          # /whois command
│   │   ├── whatis.ts         # /whatis command
│   │   └── ask.ts            # /ask command
│   └── lib/
│       ├── discord.ts        # Discord API helpers
│       ├── verify.ts         # Signature verification
│       └── format.ts         # URL/name formatting utils
├── package.json
├── tsconfig.json
└── wrangler.toml
```

## Key Differences from Old Bot

| Aspect | Old Bot | New Bot |
|--------|---------|---------|
| Language | JavaScript | TypeScript |
| Service calls | HTTP to other workers | Direct service imports |
| Secrets | Hardcoded in wrangler.toml | `.dev.vars` + `wrangler secret put` |
| Caching | Via worker service bindings | Via KV namespace binding |

## Rollback Plan

If issues occur after cutover:
1. Go to Discord Developer Portal → Application → General Information
2. Change "Interactions Endpoint URL" back to old worker URL
3. Old bot remains deployed and functional

## Notes

- The bot uses `tweetnacl` for signature verification - need to add as dependency
- Discord requires responding within 3 seconds, so we use `context.waitUntil()` for async work
- Album URLs should point to `listentomore.com/album/:spotifyId` (new format, not old slug format)
