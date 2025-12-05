// About page

import { Layout } from '../../components/layout';

export function AboutPage() {
  return (
    <Layout title="About" description="About Listen To More - a music discovery platform">
      <h1>About Listen To More</h1>

      <p>
        <strong>Listen To More</strong> is a music discovery platform designed to help you explore
        albums, learn about artists, and find your next favorite listen. Search for any album or
        artist to get detailed information, streaming links across all platforms, and AI-generated
        summaries. It also connects with Last.fm so you can view your personalized <a href="/stats">listening statistics</a>.
        A companion <a href="/discord">Discord bot</a> lets you quickly share
        album details and streaming links in any server.
      </p>
      <p>
        Created by{' '}
        <a href="https://elezea.com/" target="_blank" rel="noopener noreferrer">
          Rian van der Merwe
        </a>
        .
      </p>

      <h2>Nerdy details</h2>
      <p>
        The site uses APIs from Last.fm, Spotify, OpenAI, and Perplexity to get album and artist
        data and generate some interesting facts about it all. It is built on{' '}
        <a href="https://cloudflare.com/" target="_blank" rel="noopener noreferrer">
          Cloudflare
        </a>{' '}
        products, including{' '}
        <a href="https://workers.cloudflare.com/" target="_blank" rel="noopener noreferrer">
          Workers
        </a>
        ,{' '}
        <a
          href="https://www.cloudflare.com/developer-platform/workers-kv/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Workers KV
        </a>
        , and{' '}
        <a
          href="https://developers.cloudflare.com/d1/"
          target="_blank"
          rel="noopener noreferrer"
        >
          D1
        </a>
        . It's a wonderful set of tools to work with—and I'm not just saying that because{' '}
        <a href="https://elezea.com/resume/" target="_blank" rel="noopener noreferrer">
          I work there
        </a>
        .
      </p>
      <p>
        If you want to chat about this project, feel free to{' '}
        <a href="https://elezea.com/contact/" target="_blank" rel="noopener noreferrer">
          reach out
        </a>
        ! And if you spot any bugs (there are lots!) or have any ideas for things to add, please{' '}
        <a
          href="https://github.com/rianvdm/listentomore/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          submit an issue on GitHub
        </a>
        .
      </p>

    </Layout>
  );
}
