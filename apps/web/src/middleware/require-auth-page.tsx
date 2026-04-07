// ABOUTME: Full-page auth gate middleware for feature gating.
// ABOUTME: Renders a sign-in CTA page instead of redirecting to /login.

import { createMiddleware } from 'hono/factory';
import type { Bindings, Variables } from '../types';
import { Layout } from '../components/layout';
import { SignInCTA } from '../components/ui';

export const requireAuthPage = createMiddleware<{
  Bindings: Bindings;
  Variables: Variables;
}>(async (c, next) => {
  if (c.get('isAuthenticated')) {
    await next();
    return;
  }

  const currentPath = c.req.path;
  return c.html(
    <Layout title="Sign In Required" currentUser={null}>
      <div style={{ paddingTop: '2rem' }}>
        <SignInCTA currentPath={currentPath} />
      </div>
    </Layout>
  );
});
