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
