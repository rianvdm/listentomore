// Main layout component that wraps all pages
// Provides consistent structure, navigation, and styling

import type { Child } from 'hono/jsx';
import { SITE_CONFIG } from '@listentomore/config';
import { globalStyles } from '../../styles/globals';
import { NavBar } from './NavBar';

interface LayoutProps {
  children: Child;
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  internalToken?: string;
}

// Default fallback image for social sharing
const DEFAULT_OG_IMAGE = 'https://file.elezea.com/listentomore-og.png';

export function Layout({ children, title, description, image, url, internalToken }: LayoutProps) {
  const pageTitle = title ? `${title} | ${SITE_CONFIG.name}` : SITE_CONFIG.name;
  const pageDescription = description || SITE_CONFIG.description;
  const ogImage = image || DEFAULT_OG_IMAGE;

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />

        {/* Open Graph */}
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SITE_CONFIG.name} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:image:width" content="640" />
        <meta property="og:image:height" content="640" />
        <meta property="og:image:type" content="image/jpeg" />
        {url && <meta property="og:url" content={url} />}

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />
        <meta name="twitter:image" content={ogImage} />

        {/* Favicons */}
        <link rel="shortcut icon" type="image/x-icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />

        {/* PWA */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1DB954" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />

        {/* Global Styles */}
        <style dangerouslySetInnerHTML={{ __html: globalStyles }} />

        {/* Markdown parser for AI summaries */}
        <script src="https://cdn.jsdelivr.net/npm/marked/lib/marked.umd.js"></script>

        {/* Theme Script - runs before render to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.setAttribute('data-theme', 'dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />

        {/* Internal API Token - for progressive loading fetch calls */}
        {internalToken && (
          <script
            dangerouslySetInnerHTML={{
              __html: `
                window.__INTERNAL_TOKEN__ = '${internalToken}';
                window.internalFetch = function(url, options) {
                  options = options || {};
                  options.headers = options.headers || {};
                  options.headers['X-Internal-Token'] = window.__INTERNAL_TOKEN__;
                  return fetch(url, options);
                };
              `,
            }}
          />
        )}
      </head>
      <body>
        <NavBar />

        <main class="main-content">{children}</main>

        <footer class="footer">
          <p>
            Built with 🎧 by <a href="https://elezea.com" target="_blank" rel="noopener noreferrer">Rian van der Merwe</a>
            <br />
            <a href="https://github.com/rianvdm/listentomore/issues" target="_blank" rel="noopener noreferrer">
              Submit a bug
            </a>
            {' | '}
            <a href="/privacy">Privacy</a>
            {' | '}
            <a href="/terms">Terms</a>
          </p>
        </footer>

        {/* Theme Toggle Script */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var toggle = document.getElementById('theme-toggle');
                if (!toggle) return;

                function updateIcon() {
                  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                  toggle.textContent = isDark ? '☀️' : '🌙';
                  toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
                }

                toggle.addEventListener('click', function() {
                  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                  var newTheme = isDark ? 'light' : 'dark';
                  document.documentElement.setAttribute('data-theme', newTheme === 'dark' ? 'dark' : '');
                  localStorage.setItem('theme', newTheme);
                  updateIcon();
                });

                updateIcon();
              })();
            `,
          }}
        />
      </body>
    </html>
  );
}

export default Layout;
