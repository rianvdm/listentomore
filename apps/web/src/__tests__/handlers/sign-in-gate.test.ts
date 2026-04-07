// SignInGate component rendering tests

import { describe, it, expect } from 'vitest';
import { SignInGate } from '../../components/ui/SignInGate';

describe('SignInGate', () => {
  it('renders children when user is authenticated', () => {
    const html = SignInGate({
      currentUser: { id: '1', username: 'test' } as any,
      currentPath: '/album/abc',
      children: '<div>Protected content</div>',
    }).toString();

    expect(html).toContain('Protected content');
    expect(html).not.toContain('Sign in to unlock more');
  });

  it('renders SignInCTA when user is null', () => {
    const html = SignInGate({
      currentUser: null,
      currentPath: '/album/abc',
      children: '<div>Protected content</div>',
    }).toString();

    expect(html).not.toContain('Protected content');
    expect(html).toContain('Sign in to unlock more');
    expect(html).toContain('/login?next=%2Falbum%2Fabc');
  });
});
