// ABOUTME: Tests that Layout emits a canonical link from its url prop and a robots meta tag when noindex is set.
// ABOUTME: Both tags are absent unless asked for, so pages opt in explicitly.

import { describe, it, expect } from 'vitest';
import { Layout } from '../../components/layout';

const CANONICAL = /<link rel="canonical" href="([^"]+)"\s*\/?>/;
const ROBOTS = /<meta name="robots" content="([^"]+)"\s*\/?>/;

describe('Layout indexing tags', () => {
  it('emits a canonical link and matching og:url when given a url', () => {
    const html = Layout({ title: 'OK Computer', url: 'https://listentomore.com/album/abc', children: '' }).toString();

    expect(html.match(CANONICAL)?.[1]).toBe('https://listentomore.com/album/abc');
    expect(html).toContain('<meta property="og:url" content="https://listentomore.com/album/abc"');
  });

  it('emits no canonical link without a url', () => {
    const html = Layout({ title: 'Search', children: '' }).toString();

    expect(html).not.toMatch(CANONICAL);
  });

  it('emits noindex, follow when noindex is set', () => {
    const html = Layout({ title: 'Search', noindex: true, children: '' }).toString();

    expect(html.match(ROBOTS)?.[1]).toBe('noindex, follow');
  });

  it('emits no robots meta tag by default', () => {
    const html = Layout({ title: 'About', children: '' }).toString();

    expect(html).not.toMatch(ROBOTS);
  });
});
