# Listen To More

A music discovery platform that combines real-time listening data with AI-powered insights. Built with Hono on Cloudflare Workers.

**Live site:** [listentomore.com](https://listentomore.com)

## Features

### Music Discovery
- **Album & Artist Search** - Search the Spotify catalog with instant results
- **Album Detail Pages** - Rich album pages with release info, track listings, genres, and AI-generated summaries with citations
- **Artist Detail Pages** - Artist profiles with biography, top albums, similar artists, and genre connections
- **AI-Powered Summaries** - Get rich, contextual information about any artist, album, or genre powered by Perplexity AI (with source citations)
- **Genre Exploration** - Discover music by genre with AI-generated descriptions, history, and key artists
- **Cross-Platform Streaming Links** - Every album includes direct links to Spotify, Apple Music, and YouTube via UPC matching
- **Album Recommendations** - AI-generated "if you like this, try these" recommendations on album pages

### Personal Stats
- **Real-time Listening Stats** - Connect your Last.fm account to see your recent listening activity
- **Top Artists & Albums** - View your most-played music over different time periods (7 days, 30 days, etc.)
- **Personalized Recommendations** - Discover new artists based on your listening habits and similar artist connections
- **Loved Tracks** - See your favorite tracks with AI-generated artist insights

### Home Feed
- **Community Listening** - See what registered users are listening to in real-time (updates every 5 minutes)
- **Daily Music Facts** - A new AI-generated music fact every hour

### Discord Bot
- `/listento artist:X album:Y` - Get album details with streaming links and AI summary
- `/listenlast lastfm_user:X` - See what someone is listening to on Last.fm
- `/listenurl url:X` - Get cross-platform links from a Spotify URL
- `/whois artist:X` - Quick AI summary of any artist
- `/whatis genre:X` - AI explanation of a music genre
- `/ask question:X` - Chat with the Rick Rubin AI personality

### REST API
Full programmatic access to music discovery features. See [API Documentation](docs/API.md) for details.

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/album` | Album details with AI summary and streaming links |
| `GET /api/v1/album/recommendations` | AI-generated album recommendations |
| `GET /api/v1/links` | Cross-platform streaming links (Spotify, Apple Music, YouTube) |
| `GET /api/v1/artist` | Artist info with AI summary and top albums |
| `GET /api/v1/genre` | AI-generated genre description |
| `POST /api/v1/ask` | Chat with the music AI |

Rate-limited with tiered access (standard: 60 req/min, premium: 300 req/min).

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
│   │   ├── songlink/           # Odesli/Songlink API client
│   │   └── streaming-links/    # Apple Music + YouTube link matching
│   ├── db/                     # D1 schema, migrations, queries
│   ├── config/                 # Centralized config (cache TTLs, AI prompts)
│   └── shared/                 # Shared types and utilities
└── docs/                       # Technical documentation
```

## API

The platform exposes a REST API (`/api/v1/`) focused on AI-powered insights and cross-platform streaming links. All endpoints require an API key via the `X-API-Key` header.

See the **[API Documentation](docs/API.md)** for full details including authentication, rate limits, response examples, and endpoint reference.

## Getting Started

### Prerequisites
- Node.js 18+
- pnpm 9+
- Cloudflare account (for D1 and KV)

### Installation

```bash
# Clone the repository
git clone https://github.com/rianvdm/listentomore.git
cd listentomore

# Install dependencies
pnpm install

# Set up environment variables (see Environment Variables section below)
touch apps/web/.dev.vars
# Edit .dev.vars with your API keys
```

### Environment Variables

Create `apps/web/.dev.vars`:

```bash
# Required
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REFRESH_TOKEN=your_spotify_refresh_token
LASTFM_API_KEY=your_lastfm_api_key
LASTFM_USERNAME=your_lastfm_username
OPENAI_API_KEY=your_openai_api_key
PERPLEXITY_API_KEY=your_perplexity_api_key
INTERNAL_API_SECRET=your_random_secret_for_internal_apis

# Optional - for admin features
ADMIN_SECRET=your_admin_secret

# Optional - for cross-platform streaming links
YOUTUBE_API_KEY=your_youtube_api_key
APPLE_TEAM_ID=your_apple_team_id
APPLE_KEY_ID=your_apple_key_id
APPLE_PRIVATE_KEY=your_apple_private_key
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
- **[Apple MusicKit API](https://developer.apple.com/musickit/)** - Cross-platform streaming links via UPC matching
- **[YouTube Data API](https://developers.google.com/youtube/v3)** - YouTube album/playlist links

## Want Your Own Stats Page?

The community listening feed and personal stats pages (`/u/username`) require being added to the database. If you'd like your Last.fm listening data to appear on the site:

1. **Create a Last.fm account** at [last.fm](https://www.last.fm) if you don't have one
2. **Connect a scrobbler** to track your listening (Spotify, Apple Music, etc. all have scrobbling options)
3. **Contact me** to request being added:
   - Open an issue on this repo
   - Email: rian@elezea.com
   - Mastodon: [@rian@hachyderm.io](https://hachyderm.io/@rian)

Once added, your listening activity will appear on the home page feed and you'll have your own stats page at `listentomore.com/u/your-lastfm-username`.

## License

Private - All rights reserved.

## Author

Built by [Rian van der Merwe](https://elezea.com)
