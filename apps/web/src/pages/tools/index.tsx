// Tools page - Discord bot and Last.fm MCP server

import type { User } from '@listentomore/db';
import { Layout } from '../../components/layout';

interface ToolsPageProps {
  currentUser?: User | null;
}

export function ToolsPage({ currentUser }: ToolsPageProps) {
  return (
    <Layout title="Tools" description="Tools and integrations for Listen To More" currentUser={currentUser}>
      <h1>Tools & Integrations</h1>

      <p>
        Extend your music discovery experience with these tools and integrations.
      </p>

      {/* Discord Bot */}
      <section style={{ marginTop: '2rem' }}>
        <h2>🤖 Discord Bot</h2>
        <p>
          If you're part of a Discord server where you share music with each other, the Listen To
          More Discord Bot lets you easily generate streaming links and album information.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', margin: '1.5em 0' }}>
          <a href="/discord" class="button">
            Learn More
          </a>
        </div>
      </section>

      {/* Last.fm MCP Server */}
      <section style={{ marginTop: '3rem' }}>
        <h2>🎵 Last.fm MCP Server</h2>
        <p>
          Connect your AI assistant (like Claude) to Last.fm with the{' '}
          <a href="https://lastfm-mcp.com/" target="_blank" rel="noopener noreferrer">
            Last.fm MCP Server
          </a>
          . This Model Context Protocol server lets AI assistants access your Last.fm listening
          history, top artists, loved tracks, and more.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', margin: '1.5em 0' }}>
          <a
            href="https://lastfm-mcp.com/"
            class="button"
            target="_blank"
            rel="noopener noreferrer"
          >
            Learn More
          </a>
        </div>

        <h3>Features</h3>
        <ul>
          <li>
            <strong>Recent Tracks</strong> - See what you've been listening to
          </li>
          <li>
            <strong>Top Artists & Albums</strong> - Your most-played music over various time periods
          </li>
          <li>
            <strong>Loved Tracks</strong> - Your favorite songs on Last.fm
          </li>
          <li>
            <strong>Similar Artists</strong> - Discover new music based on your tastes
          </li>
        </ul>
      </section>
    </Layout>
  );
}

export default ToolsPage;
