# About Listen To More

## Why This Exists

Listen To More started as a personal project to scratch an itch: I wanted a better way to learn more about the music I listen to. Streaming services are great for listening, but they're not great for *understanding* music—the context, the history, the connections between artists and albums.

I also wanted to track my listening habits in a more meaningful way than what Last.fm or Spotify Wrapped offer. Not just "you listened to X hours of music" but actual insights into what I'm gravitating toward and why.

## The Philosophy

### AI as Context, Not Content

The AI features here aren't about generating music or replacing human curation. They're about providing *context*. When you look up an album, you get a summary that tells you why it matters, what influenced it, and what it influenced. The AI is trained to be informative and grounded in facts, with citations where possible.

### Progressive Enhancement

The site is designed to be fast first. Pages render in under 300ms with basic information, then progressively load richer content. This means you're never staring at a loading spinner—you get useful information immediately, and more detail as it becomes available.

### Server-Side by Default

No React, no Vue, no client-side routing. Just HTML rendered on the server with a sprinkle of vanilla JavaScript for progressive enhancement. This keeps the bundle tiny, the time-to-interactive instant, and the experience snappy on any device.

### Open API

The same API that powers the website is available to anyone with an API key. Build your own music tools, integrate with your own projects, or just explore the data programmatically.

## Technical Choices

### Why Cloudflare Workers?

Edge computing means the app runs close to users worldwide. Combined with D1 (distributed SQLite) and KV (key-value caching), the entire stack is globally distributed with no cold starts.

### Why Hono?

Hono is a lightweight, fast web framework designed for edge computing. It's like Express but built for Cloudflare Workers from the ground up. JSX support means templates are type-safe and components are reusable.

### Why Perplexity for AI Summaries?

Perplexity's Sonar model is designed for grounded, factual responses with citations. For music information, this is exactly what we need—accurate facts about artists and albums, not hallucinated content. The citations let users verify information and explore further.

### Why Last.fm?

Last.fm has been tracking listening data for nearly 20 years. Their API is comprehensive, their data is rich, and they support the kind of detailed listening history that Spotify doesn't expose. Plus, they work across all music services, not just one.

## The Name

"Listen To More" is both a description and an imperative. It describes what the site helps you do (discover and understand more music) and encourages you to do exactly that. Life's too short for the same playlist on repeat.

## Who Built This

I'm [Rian van der Merwe](https://elezea.com), a product manager by day and music nerd by night. I've been building music-related side projects for years, and this is the latest iteration of ideas I've been refining since I first started using Last.fm in 2005.

## Feedback

Found a bug? Have a feature request? Want to tell me about an artist I should check out? [Get in touch](https://elezea.com/contact/).
