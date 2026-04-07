// ABOUTME: Sign-in call-to-action component for feature gating.
// ABOUTME: Shared by SignInGate (per-section) and requireAuthPage (full-page) patterns.

interface SignInCTAProps {
  currentPath: string;
}

export function SignInCTA({ currentPath }: SignInCTAProps) {
  const loginUrl = `/login?next=${encodeURIComponent(currentPath)}`;

  return (
    <div class="cta-box" style={{ maxWidth: '600px', marginTop: '2rem' }}>
      <h3 style={{ marginTop: '0' }}>Sign in to unlock more</h3>
      <ul style={{ textAlign: 'left', margin: '1rem auto', maxWidth: '400px' }}>
        <li>AI-powered album and artist summaries</li>
        <li>Personalized music recommendations</li>
        <li>Weekly listening insights</li>
        <li>Your listening stats and history</li>
        <li>Public profile page</li>
      </ul>
      <a href={loginUrl} class="button">Sign in with Last.fm</a>
    </div>
  );
}
