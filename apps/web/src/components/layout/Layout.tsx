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
}

export function Layout({ children, title, description }: LayoutProps) {
  const pageTitle = title ? `${title} | ${SITE_CONFIG.name}` : SITE_CONFIG.name;
  const pageDescription = description || SITE_CONFIG.description;

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

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />

        {/* Favicon */}
        <link rel="icon" href="/favicon.ico" />

        {/* Global Styles */}
        <style dangerouslySetInnerHTML={{ __html: globalStyles }} />

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
