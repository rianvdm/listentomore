# Listen To More

A music discovery platform that combines real-time listening data with AI-powered insights. Built with Hono on Cloudflare Workers.

**Live site:** [listentomore.com](https://listentomore.com)

## Features

### User Accounts
- **Sign in with Last.fm** - One-click authentication using your Last.fm account
- **Personal Profile** - Your own profile page at `/u/your-username` with listening stats
- **Privacy Controls** - Choose to make your profile public or private
- **Account Settings** - Manage your display name, bio, and privacy preferences

### Music Discovery
- **Album & Artist Search** - Search the Spotify catalog with instant results
- **Album Detail Pages** - Rich album pages with release info, track listings, genres, and AI-generated summaries with citations
- **Artist Detail Pages** - Artist profiles with biography, top albums, similar artists, and genre connections
- **AI-Powered Summaries** - Get rich, contextual information about any artist, album, or genre powered by Perplexity AI (with source citations)
- **Genre Exploration** - Discover music by genre with AI-generated descriptions, history, and key artists
- **Cross-Platform Streaming Links** - Every album includes direct links to Spotify, Apple Music, and Songlink (for all other services)
- **Album Recommendations** - AI-generated "if you like this, try these" recommendations on album pages

### Personal Stats
- **Real-time Listening Stats** - See your recent listening activity from Last.fm
- **Top Artists & Albums** - View your most-played music over different time periods (7 days, 30 days, etc.)
- **Personalized Recommendations** - Discover new artists based on your listening habits and similar artist connections
- **Loved Tracks** - See your favorite tracks with AI-generated artist insights
- **Weekly Insights** - AI-powered analysis of your 7-day listening patterns with personalized album recommendations (GPT-5.2)

### Home Feed
- **Community Listening** - See what registered users are listening to in real-time (updates every 5 minutes)
- **Daily Music Facts** - A new AI-generated music fact every hour

### Tools & Integrations
- **Discord Bot** - Share album details and streaming links in your Discord server ([learn more](/discord))
- **Last.fm MCP Server** - Connect AI assistants like Claude to your Last.fm data ([lastfm-mcp.com](https://lastfm-mcp.com))

### Discord Bot Commands
- `/listento artist:X album:Y` - Get album details with streaming links and AI summary
- `/listenlast lastfm_user:X` - See what someone is listening to on Last.fm
- `/listenurl url:X` - Get cross-platform links from a Spotify URL
- `/whois artist:X` - Quick AI summary of any artist
- `/whatis genre:X` - AI explanation of a music genre
- `/ask question:X` - Chat with the Rick Rubin AI personality

### REST API
Full programmatic access to music discovery features. Rate-limited with tiered access (standard: 60 req/min, premium: 300 req/min). See [API Documentation](docs/API.md) for details or [contact me](https://elezea.com/contact) to request an API key.

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

# Optional - for Apple Music direct links
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
- **[OpenAI API](https://platform.openai.com)** - GPT-5 for chatbot and fact generation
- **[Perplexity API](https://docs.perplexity.ai)** - Sonar model for grounded, cited summaries
- **[Apple MusicKit API](https://developer.apple.com/musickit/)** - Cross-platform streaming links via UPC matching
- **[Songlink/Odesli](https://odesli.co)** - Cross-platform streaming links for all services

## Get Started

1. **Visit [listentomore.com](https://listentomore.com)**
2. **Click "Sign In"** and connect your Last.fm account
3. **That's it!** Your profile is live at `listentomore.com/u/your-lastfm-username`

Don't have a Last.fm account? [Create one for free](https://www.last.fm/join) and connect a scrobbler to track your listening from Spotify, Apple Music, or any other service.

## License

Private - All rights reserved.

## Author

Built by [Rian van der Merwe](https://elezea.com)
