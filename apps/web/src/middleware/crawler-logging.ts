// Middleware to log social crawler requests for debugging
import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from '../types';

const SOCIAL_CRAWLERS = [
  'LinkedInBot',
  'facebookexternalhit',
  'Twitterbot',
  'Slackbot',
  'TelegramBot',
  'WhatsApp',
  'Mastodon',
  'http.rb',
  'Discordbot',
];

export const crawlerLoggingMiddleware = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
  const userAgent = c.req.header('User-Agent') || '';
  const isCrawler = SOCIAL_CRAWLERS.some(crawler => userAgent.includes(crawler));

  if (isCrawler) {
    const url = new URL(c.req.url);
    console.log('🤖 Social Crawler Request:', {
      userAgent,
      path: url.pathname,
      fullUrl: c.req.url,
      method: c.req.method,
      referer: c.req.header('Referer'),
      cfRay: c.req.header('CF-Ray'),
      cfConnectingIP: c.req.header('CF-Connecting-IP'),
      timestamp: new Date().toISOString(),
    });
  }

  await next();

  // Log the response status for crawlers
  if (isCrawler) {
    console.log('🤖 Social Crawler Response:', {
      userAgent,
      status: c.res.status,
      contentType: c.res.headers.get('Content-Type'),
      cfRay: c.req.header('CF-Ray'),
    });
  }
});
