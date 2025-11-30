# Listen To More

A music discovery platform that combines real-time listening data with AI-powered insights. Built with Hono on Cloudflare Workers.

**Live site:** [listentomore.com](https://listentomore.com)

## Features

### Music Discovery
- **Album & Artist Search** - Search the Spotify catalog with instant results
- **AI-Powered Summaries** - Get rich, contextual information about any artist, album, or genre powered by Perplexity AI
- **Genre Exploration** - Discover music by genre with AI-generated descriptions and key artists
- **Universal Streaming Links** - Every album includes links to all major streaming platforms via Songlink/Odesli

### Personal Stats
- **Real-time Listening Stats** - Connect your Last.fm account to see your recent listening activity
- **Top Artists & Albums** - View your most-played music over different time periods
- **Personalized Recommendations** - Discover new artists based on your listening habits
- **Loved Tracks** - See your favorite tracks with AI-generated artist insights

### Home Feed
- **Community Listening** - See what registered users are listening to in real-time
- **Daily Music Facts** - A new AI-generated music fact every hour

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | [Hono](https://hono.dev) |
| **Runtime** | [Cloudflare Workers](https://workers.cloudflare.com) |
| **Database** | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite) |
| **Caching** | [Cloudflare KV](https://developers.cloudflare.com/kv/) |
| **Language** | TypeScript |
| **Monorepo** | [Turborepo](https://turbo.build) + pnpm |
| **Testing** | Vitest |

## Architecture

The application follows a **progressive loading** pattern:
1. Pages render instantly with basic data from Spotify (~300ms)
2. AI summaries and additional data stream in via client-side JavaScript
3. Links are progressively enriched with direct Spotify IDs

All pages are **server-side rendered** - no client-side frameworks, just vanilla JS for progressive enhancement.

## Project Structure

```
listentomore/
├── apps/
│   ├── web/                    # Main Hono web app (Cloudflare Worker)
│   └── discord-bot/            # Discord bot for music commands
├── packages/
│   ├── services/               # Backend service modules
│   │   ├── spotify/            # Spotify Web API client
│   │   ├── lastfm/             # Last.fm API client
│   │   ├── ai/                 # OpenAI + Perplexity clients
│   │   └── songlink/           # Odesli/Songlink API client
│   ├── db/                     # D1 schema, migrations, queries
│   ├── config/                 # Centralized config (cache TTLs, AI prompts)
│   └── shared/                 # Shared types and utilities
└── tools/scripts/              # Setup and migration scripts
```

## API

The platform exposes a REST API with tiered rate limiting:

| Tier | Rate Limit | Access |
|------|------------|--------|
| Public | 10 req/min | Unauthenticated |
| Standard | 60 req/min | API key required |
| Premium | 300 req/min | API key required |

### Endpoints

**Spotify**
- `GET /api/spotify/search?q=:query&type=:type` - Search for tracks, albums, or artists
- `GET /api/spotify/album/:id` - Get album details
- `GET /api/spotify/artist/:id` - Get artist details

**Last.fm**
- `GET /api/lastfm/recent` - Recent tracks
- `GET /api/lastfm/top-albums?period=:period` - Top albums
- `GET /api/lastfm/top-artists?period=:period` - Top artists
- `GET /api/lastfm/loved` - Loved tracks

**AI**
- `GET /api/ai/artist-summary?name=:name` - AI-generated artist summary
- `GET /api/ai/album-detail?artist=:artist&album=:album` - AI-generated album analysis
- `GET /api/ai/genre-summary?genre=:genre` - AI-generated genre overview
- `POST /api/ai/ask` - Ask the music AI chatbot
- `POST /api/ai/playlist-cover/prompt` - Generate DALL-E prompt for playlist art
- `POST /api/ai/playlist-cover/image` - Generate playlist cover image

**Songlink**
- `GET /api/songlink?url=:streamingUrl` - Get universal streaming links

## Getting Started

### Prerequisites
- Node.js 18+
- pnpm 8+
- Cloudflare account (for D1 and KV)

### Installation

```bash
# Clone the repository
git clone https://github.com/rianvdm/listentomore.git
cd listentomore

# Install dependencies
pnpm install

# Set up environment variables
cp apps/web/.dev.vars.example apps/web/.dev.vars
# Edit .dev.vars with your API keys
```

### Environment Variables

Create `apps/web/.dev.vars`:

```bash
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REFRESH_TOKEN=your_spotify_refresh_token
LASTFM_API_KEY=your_lastfm_api_key
LASTFM_USERNAME=your_lastfm_username
OPENAI_API_KEY=your_openai_api_key
PERPLEXITY_API_KEY=your_perplexity_api_key
```

### Development

```bash
# Run development server
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Deploy to Cloudflare
pnpm deploy
```

## External Services

- **[Spotify Web API](https://developer.spotify.com/documentation/web-api)** - Music catalog data
- **[Last.fm API](https://www.last.fm/api)** - Listening history and scrobbles
- **[OpenAI API](https://platform.openai.com)** - GPT-4 for chatbot and fact generation, DALL-E for image generation
- **[Perplexity API](https://docs.perplexity.ai)** - Sonar model for grounded, cited summaries
- **[Songlink/Odesli](https://odesli.co)** - Universal streaming links

## License

Private - All rights reserved.

## Author

Built by [Rian van der Merwe](https://elezea.com)
