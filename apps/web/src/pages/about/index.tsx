// About page

import { Layout } from '../../components/layout';

export function AboutPage() {
  return (
    <Layout title="About" description="About Listen To More - a music discovery platform">
      <h1>About Listen To More</h1>

      <h2>Why This Exists</h2>
      <p>
        Listen To More started as a personal project to scratch an itch: I wanted a better way to
        learn more about the music I listen to. Streaming services are great for listening, but
        they're not great for <em>understanding</em> music—the context, the history, the
        connections between artists and albums.
      </p>
      <p>
        I also wanted to track my listening habits in a more meaningful way than what Last.fm or
        Spotify Wrapped offer. Not just "you listened to X hours of music" but actual insights into
        what I'm gravitating toward and why.
      </p>

      <h2>The Philosophy</h2>

      <h3>AI as Context, Not Content</h3>
      <p>
        The AI features here aren't about generating music or replacing human curation. They're
        about providing <em>context</em>. When you look up an album, you get a summary that tells
        you why it matters, what influenced it, and what it influenced. The AI is trained to be
        informative and grounded in facts, with citations where possible.
      </p>

      <h3>Progressive Enhancement</h3>
      <p>
        The site is designed to be fast first. Pages render in under 300ms with basic information,
        then progressively load richer content. This means you're never staring at a loading
        spinner—you get useful information immediately, and more detail as it becomes available.
      </p>

      <h3>Server-Side by Default</h3>
      <p>
        No React, no Vue, no client-side routing. Just HTML rendered on the server with a sprinkle
        of vanilla JavaScript for progressive enhancement. This keeps the bundle tiny, the
        time-to-interactive instant, and the experience snappy on any device.
      </p>

      <h3>Open API</h3>
      <p>
        The same API that powers the website is available to anyone with an API key. Build your own
        music tools, integrate with your own projects, or just explore the data programmatically.
      </p>

      <h2>Technical Choices</h2>

      <h3>Why Cloudflare Workers?</h3>
      <p>
        Edge computing means the app runs close to users worldwide. Combined with D1 (distributed
        SQLite) and KV (key-value caching), the entire stack is globally distributed with no cold
        starts.
      </p>

      <h3>Why Hono?</h3>
      <p>
        Hono is a lightweight, fast web framework designed for edge computing. It's like Express
        but built for Cloudflare Workers from the ground up. JSX support means templates are
        type-safe and components are reusable.
      </p>

      <h3>Why Perplexity for AI Summaries?</h3>
      <p>
        Perplexity's Sonar model is designed for grounded, factual responses with citations. For
        music information, this is exactly what we need—accurate facts about artists and albums,
        not hallucinated content. The citations let users verify information and explore further.
      </p>

      <h3>Why Last.fm?</h3>
      <p>
        Last.fm has been tracking listening data for nearly 20 years. Their API is comprehensive,
        their data is rich, and they support the kind of detailed listening history that Spotify
        doesn't expose. Plus, they work across all music services, not just one.
      </p>

      <h2>The Name</h2>
      <p>
        "Listen To More" is both a description and an imperative. It describes what the site helps
        you do (discover and understand more music) and encourages you to do exactly that. Life's
        too short for the same playlist on repeat.
      </p>

      <h2>Who Built This</h2>
      <p>
        I'm{' '}
        <a href="https://elezea.com" target="_blank" rel="noopener noreferrer">
          Rian van der Merwe
        </a>
        , a product manager by day and music nerd by night. I've been building music-related side
        projects for years, and this is the latest iteration of ideas I've been refining since I
        first started using Last.fm in 2005.
      </p>

      <h2>Feedback</h2>
      <p>
        Found a bug? Have a feature request? Want to tell me about an artist I should check out?{' '}
        <a href="https://elezea.com/contact/" target="_blank" rel="noopener noreferrer">
          Get in touch
        </a>
        .
      </p>

      <p style={{ marginTop: '2em' }}>
        <a href="/privacy">Privacy Policy</a> | <a href="/terms">Terms of Service</a>
      </p>
    </Layout>
  );
}
