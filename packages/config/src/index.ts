// Main entry point for @listentomore/config package

export * from './ai';
export * from './cache';

// Site-wide constants
export const SITE_CONFIG = {
  name: 'Listen To More',
  domain: 'listentomore.com',
  url: 'https://listentomore.com',
  description: 'AI-powered insights into your listening habits. See your stats, discover your favorite tracks, and share your taste with the world.',
  twitterHandle: '@listentomore',
  defaultImage: 'https://listentomore.com/og-image.png',
} as const;

// Default user ID for single-user mode
export const DEFAULT_USER_ID = 'default';

// Announcement banner configuration
// Set enabled to true and update message/link to show a banner across the site.
// Change the id whenever you update the message so dismissed state resets.
// Set expiresAt (YYYY-MM-DD) to auto-hide the banner after that date.
export const BANNER_CONFIG = {
  enabled: true,
  id: '2026-11-08-v1.6.0',
  message: 'v1.6.0: Claude now writes the summaries and insights, and pages load faster.',
  link: {
    url: 'https://github.com/rianvdm/listentomore/releases/tag/v1.6.0',
    text: 'Release notes',
  },
  expiresAt: '2026-11-15',
} as const;
