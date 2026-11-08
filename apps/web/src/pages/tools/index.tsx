// Tools page - Discord bot and Last.fm MCP server

import type { User } from '@listentomore/db';
import { Layout } from '../../components/layout';
import { SITE_CONFIG } from '@listentomore/config';

interface ToolsPageProps {
  currentUser?: User | null;
}

export function ToolsPage({ currentUser }: ToolsPageProps) {
  return (
    <Layout title="Tools" description="Tools and integrations for Listen To More" url={`${SITE_CONFIG.url}/tools`} currentUser={currentUser}>
      <h1>Tools & Integrations</h1>

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
      </section>
    </Layout>
  );
}

export default ToolsPage;
