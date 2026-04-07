// SignInCTA component rendering tests

import { describe, it, expect } from 'vitest';
import { SignInCTA } from '../../components/ui/SignInCTA';

describe('SignInCTA', () => {
  it('renders sign-in link with current path', () => {
    const html = SignInCTA({ currentPath: '/album/abc123' }).toString();
    expect(html).toContain('/login?next=%2Falbum%2Fabc123');
  });

  it('renders benefits list', () => {
    const html = SignInCTA({ currentPath: '/' }).toString();
    expect(html).toContain('AI-powered album and artist summaries');
    expect(html).toContain('Personalized music recommendations');
    expect(html).toContain('Weekly listening insights');
    expect(html).toContain('Your listening stats and history');
    expect(html).toContain('Public profile page');
  });

  it('renders heading', () => {
    const html = SignInCTA({ currentPath: '/' }).toString();
    expect(html).toContain('Sign in to unlock more');
  });
});
