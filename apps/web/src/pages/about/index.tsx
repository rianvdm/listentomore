// About page

import { Layout } from '../../components/layout';

export function AboutPage() {
  return (
    <Layout title="About" description="About Listen To More - a music discovery platform">
      <h1>About Listen To More</h1>

      <h2>Why This Exists</h2>
      <p>
        Listen To More started as a personal project to scratch an itch: I wanted a better way to
        discover and learn about music. Streaming services are great for listening, but they're not
        great for <em>understanding</em> music - the context, the history, the connections between
        artists and albums.
      </p>
      <p>
        I also wanted to track my listening habits in a more meaningful way. Not just "you listened
        to X hours of music" but actual insights into what I'm gravitating toward and why.
      </p>

      <h2>What You Can Do Here</h2>
      <ul>
        <li>
          <strong>Search albums and artists</strong> - Get AI-powered summaries that tell you why an
          album matters, what influenced it, and what it sounds like
        </li>
        <li>
          <strong>Explore genres</strong> - Discover new music through AI-generated genre guides
          with key artists and albums
        </li>
        <li>
          <strong>Track your listening</strong> - Connect your Last.fm account to see your stats,
          top artists, and personalized recommendations
        </li>
        <li>
          <strong>Stream anywhere</strong> - Every album page includes links to all major streaming
          platforms
        </li>
      </ul>

      <h2>How It Works</h2>
      <p>
        The site is built to be fast. Pages render in under 300ms with basic information, then
        progressively load richer AI-generated content. You're never staring at a loading spinner -
        you get useful information immediately.
      </p>
      <p>
        The AI features use{' '}
        <a href="https://www.perplexity.ai" target="_blank" rel="noopener noreferrer">
          Perplexity
        </a>{' '}
        for grounded, factual responses with citations. For music information, accuracy matters -
        we want real facts about artists and albums, not hallucinated content.
      </p>

      <h2>Who Built This</h2>
      <p>
        I'm{' '}
        <a href="https://elezea.com" target="_blank" rel="noopener noreferrer">
          Rian van der Merwe
        </a>
        , a product manager by day and music nerd by night. I've been building music-related side
        projects for years, fueled by a Last.fm account I've had since 2005.
      </p>

      <h2>Get In Touch</h2>
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
