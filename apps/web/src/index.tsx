// Main entry point for the Listen To More web application
// Built with Hono on Cloudflare Workers

import { Hono } from 'hono';
import { SITE_CONFIG } from '@listentomore/config';

// Define environment bindings
type Bindings = {
  // D1 Database
  DB: D1Database;
  // KV Namespaces
  CACHE: KVNamespace;
  // Environment variables
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  LASTFM_API_KEY: string;
  OPENAI_API_KEY: string;
  PERPLEXITY_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    name: SITE_CONFIG.name,
    timestamp: new Date().toISOString(),
  });
});

// Home page
app.get('/', (c) => {
  return c.html(
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{SITE_CONFIG.name}</title>
        <meta name="description" content={SITE_CONFIG.description} />
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #fafafa;
            color: #1a1a1a;
            line-height: 1.6;
            padding: 2rem;
            max-width: 800px;
            margin: 0 auto;
          }
          h1 { color: #ff6c00; margin-bottom: 1rem; }
          p { margin-bottom: 1rem; }
          .status {
            background: #e8f5e9;
            padding: 1rem;
            border-radius: 8px;
            border-left: 4px solid #4caf50;
          }
          code {
            background: #f5f5f5;
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            font-size: 0.9em;
          }
        `}</style>
      </head>
      <body>
        <h1>{SITE_CONFIG.name}</h1>
        <p>{SITE_CONFIG.description}</p>

        <div class="status">
          <p><strong>Status:</strong> Phase 1 Complete</p>
          <p>The foundation is set up. Next: build out the services and pages.</p>
        </div>

        <h2 style="margin-top: 2rem; margin-bottom: 1rem;">Architecture</h2>
        <ul style="margin-left: 1.5rem;">
          <li>Built with <code>Hono</code> on Cloudflare Workers</li>
          <li>TypeScript monorepo with <code>Turborepo</code></li>
          <li>Packages: <code>@listentomore/shared</code>, <code>@listentomore/config</code></li>
        </ul>
      </body>
    </html>
  );
});

// API routes placeholder
app.get('/api', (c) => {
  return c.json({
    message: 'Listen To More API',
    version: '0.0.1',
    endpoints: {
      health: '/health',
      // More endpoints coming in Phase 2+
    },
  });
});

// 404 handler
app.notFound((c) => {
  return c.html(
    <html lang="en">
      <head>
        <title>404 - {SITE_CONFIG.name}</title>
        <style>{`
          body {
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: #fafafa;
          }
          .container { text-align: center; }
          h1 { color: #ff6c00; font-size: 4rem; margin-bottom: 0.5rem; }
          a { color: #ff6c00; }
        `}</style>
      </head>
      <body>
        <div class="container">
          <h1>404</h1>
          <p>Page not found</p>
          <p><a href="/">Go home</a></p>
        </div>
      </body>
    </html>,
    404
  );
});

export default app;
