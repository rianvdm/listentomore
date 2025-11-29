# Listen To More

A music discovery platform built with Hono on Cloudflare Workers.

## Tech Stack

- **Framework**: Hono (Cloudflare Workers)
- **Language**: TypeScript
- **Monorepo**: Turborepo + pnpm
- **Database**: Cloudflare D1
- **Caching**: Cloudflare KV
- **Testing**: Vitest

## Project Structure

```
listentomore/
├── apps/
│   ├── web/              # Main web application
│   └── discord-bot/      # Discord bot (future)
├── packages/
│   ├── shared/           # Shared types and utilities
│   ├── config/           # Centralized configuration
│   ├── db/               # Database schemas and queries
│   └── services/         # Backend service modules
│       ├── spotify/
│       ├── lastfm/
│       ├── discogs/
│       ├── ai/
│       ├── songlink/
│       └── library/
└── IMPLEMENTATION_PLAN.md
```

## Getting Started

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Build all packages
pnpm build

# Run tests
pnpm test

# Deploy
pnpm deploy
```

## Development

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for the full development roadmap.

## License

Private - All rights reserved.
