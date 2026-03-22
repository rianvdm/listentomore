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
export const BANNER_CONFIG = {
  enabled: true,
  id: '2026-03-22-album-matching2',
  message: 'v1.4.2: Improved album matching for Apple Music links — cross-platform lookups are now more accurate.',
  link: {
    url: 'https://github.com/rianvdm/listentomore/releases/tag/v1.4.2',
    text: 'Release notes',
  },
} as const;
