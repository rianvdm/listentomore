// Discord Bot page

import { Layout } from '../../components/layout';

export function DiscordPage() {
  return (
    <Layout title="Discord Bot" description="Add the Listen To More Discord bot to your server">
      <h1>Discord Bot</h1>

      <p>
        If you are part of a Discord server where you share music with each other, the Listen To
        More Discord Bot lets you easily generate streaming links and album information.
      </p>

      <p class="text-center" style={{ margin: '2em 0' }}>
        <a
          href="https://discord.com/oauth2/authorize?client_id=1284593290947068024"
          class="button button--large"
          target="_blank"
          rel="noopener noreferrer"
        >
          Add to Your Server
        </a>
      </p>

      <h2>Commands</h2>

      <div style={{ maxWidth: '800px', margin: '0 auto', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '2px solid var(--c-accent)' }}>
                Command
              </th>
              <th style={{ textAlign: 'left', padding: '0.75rem', borderBottom: '2px solid var(--c-accent)' }}>
                Description
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)' }}>
                <code>/listento</code>
              </td>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)' }}>
                Enter an album and artist, get streaming links for all platforms as well as a link
                to more details about the album.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)' }}>
                <code>/listenurl</code>
              </td>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)' }}>
                The same as <code>/listento</code>, but enter a streaming URL from any platform
                (Spotify, Apple Music, etc.).
              </td>
            </tr>
            <tr>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)' }}>
                <code>/listenlast</code>
              </td>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)' }}>
                Enter your Last.fm username, get the same details for the last album you listened
                to.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)' }}>
                <code>/whois</code>
              </td>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)' }}>
                One-sentence summary of an artist.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)' }}>
                <code>/whatis</code>
              </td>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)' }}>
                Two-sentence summary of a musical genre, with a link to history, artists, and albums
                to check out.
              </td>
            </tr>
            <tr>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)' }}>
                <code>/ask</code>
              </td>
              <td style={{ padding: '0.75rem', borderBottom: '1px solid rgba(var(--c-base-rgb), 0.1)' }}>
                Short answers to your most pressing music questions, using Rick Rubin as the
                personality.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Example</h2>
      <p>
        The <code>/listento</code>, <code>/listenurl</code>, and <code>/listenlast</code> commands
        return details like this:
      </p>
      <p class="text-center">
        <img
          src="https://file.elezea.com/20241006-diqSo8zX-2x.png"
          alt="Discord bot example showing album details and streaming links"
          style={{ maxWidth: '100%', borderRadius: '8px' }}
        />
      </p>

      <h2>Support</h2>
      <p>
        If you run into any issues or have feature requests, please{' '}
        <a
          href="https://github.com/rianvdm/listentomore/issues"
          target="_blank"
          rel="noopener noreferrer"
        >
          submit an issue on GitHub
        </a>{' '}
        or{' '}
        <a href="https://elezea.com/contact/" target="_blank" rel="noopener noreferrer">
          get in touch
        </a>
        .
      </p>
    </Layout>
  );
}
