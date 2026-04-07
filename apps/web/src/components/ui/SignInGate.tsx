// ABOUTME: Per-section auth gate component for feature gating.
// ABOUTME: Renders children for authenticated users, sign-in CTA for anonymous users.

import type { Child } from 'hono/jsx';
import type { User } from '@listentomore/db';
import { SignInCTA } from './SignInCTA';

interface SignInGateProps {
  currentUser: User | null;
  currentPath: string;
  children: Child;
}

export function SignInGate({ currentUser, currentPath, children }: SignInGateProps) {
  if (currentUser) {
    return <>{children}</>;
  }

  return <SignInCTA currentPath={currentPath} />;
}
