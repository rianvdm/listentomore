// ABOUTME: Tests for robots.txt: search and user-triggered AI fetchers may crawl pages, training crawlers may not.
// ABOUTME: Parses the file into groups the way a crawler would, so a misplaced line fails the test.

import { describe, it, expect } from 'vitest';
import { ROBOTS_TXT, TRAINING_CRAWLERS } from '../robots';

interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
}

// Minimal robots.txt parser: consecutive User-agent lines open a group,
// and the rules that follow belong to it until the next User-agent line.
function parseGroups(text: string): { groups: RobotsGroup[]; directives: string[] } {
  const groups: RobotsGroup[] = [];
  const directives: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [field, ...rest] = line.split(':');
    const key = field.trim().toLowerCase();
    const value = rest.join(':').trim();
    directives.push(key);

    if (key === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow') current.allow.push(value);
    if (key === 'disallow') current.disallow.push(value);
  }
  return { groups, directives };
}

// A crawler obeys the most specific group naming it, else the * group.
function groupFor(groups: RobotsGroup[], agent: string): RobotsGroup | undefined {
  const name = agent.toLowerCase();
  return groups.find((g) => g.agents.includes(name)) ?? groups.find((g) => g.agents.includes('*'));
}

describe('robots.txt', () => {
  const { groups, directives } = parseGroups(ROBOTS_TXT);

  it('keeps every crawler out of /api/', () => {
    for (const agent of ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'PerplexityBot', 'SomeNewBot']) {
      expect(groupFor(groups, agent)?.disallow, agent).toContain('/api/');
    }
  });

  it('lets search and user-triggered AI fetchers crawl pages', () => {
    const fetchers = [
      'Googlebot',
      'Bingbot',
      'OAI-SearchBot',
      'ChatGPT-User',
      'Claude-SearchBot',
      'Claude-User',
      'PerplexityBot',
      'Perplexity-User',
    ];
    for (const agent of fetchers) {
      expect(groupFor(groups, agent)?.disallow, agent).not.toContain('/');
    }
  });

  it('blocks every AI training crawler from the whole site', () => {
    expect(TRAINING_CRAWLERS).toEqual(
      expect.arrayContaining(['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'Applebot-Extended'])
    );
    for (const agent of TRAINING_CRAWLERS) {
      expect(groupFor(groups, agent)?.disallow, agent).toContain('/');
    }
  });

  it('drops Crawl-delay, retired Anthropic names and the sitemap line', () => {
    expect(directives).not.toContain('crawl-delay');
    expect(directives).not.toContain('sitemap');
    const agents = groups.flatMap((g) => g.agents);
    expect(agents).not.toContain('anthropic-ai');
    expect(agents).not.toContain('claude-web');
  });
});
