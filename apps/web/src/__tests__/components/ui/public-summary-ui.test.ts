// ABOUTME: Tests for the UI pieces shown around public cached summaries.
// ABOUTME: Covers the personal sign-in prompt, the AI summary label and its About page anchor.

import { describe, it, expect } from 'vitest';
import { AiSummaryLabel } from '../../../components/ui/AiSummaryLabel';
import { SignInCTA } from '../../../components/ui/SignInCTA';
import { AboutPage } from '../../../pages/about';

describe('SignInCTA variants', () => {
  it('personal CTA pitches personal features, not AI summaries', () => {
    const html = SignInCTA({ currentPath: '/album/x', variant: 'personal' }).toString();
    expect(html).toContain('Sign in with Last.fm for more');
    expect(html).toContain('Your listening stats and history');
    expect(html).toContain('Weekly listening insights');
    expect(html).toContain('Recommendations based on what you play');
    expect(html).toContain('A public profile page');
    expect(html).toContain('href="/login?next=%2Falbum%2Fx"');
    expect(html).not.toMatch(/AI-powered album and artist summaries/);
    expect(html).not.toMatch(/summar/i);
  });

  it('default CTA is unchanged', () => {
    const html = SignInCTA({ currentPath: '/album/x' }).toString();
    expect(html).toContain('Sign in to unlock more');
    expect(html).toContain('AI-powered album and artist summaries');
    expect(html).toBe(SignInCTA({ currentPath: '/album/x', variant: 'unlock' }).toString());
  });
});

describe('AiSummaryLabel', () => {
  it('label links to the About anchor', () => {
    const html = AiSummaryLabel().toString();
    expect(html).toBe(
      '<p class="ai-summary-label text-muted"><a href="/about#how-its-built">AI-written summary</a></p>',
    );
  });

  it('About has the anchor', () => {
    const html = AboutPage({ currentUser: null }).toString();
    expect(html).toContain('id="how-its-built"');
  });
});
