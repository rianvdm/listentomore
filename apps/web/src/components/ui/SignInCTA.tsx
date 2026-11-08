// ABOUTME: Sign-in call-to-action component for feature gating.
// ABOUTME: Shared by SignInGate (per-section) and requireAuthPage (full-page) patterns.

type SignInCTAVariant = 'unlock' | 'personal';

interface SignInCTAProps {
  currentPath: string;
  // 'personal' is for pages that already show a public AI summary, so it pitches only signed-in features.
  variant?: SignInCTAVariant;
}

const CTA_COPY: Record<SignInCTAVariant, { heading: string; bullets: string[] }> = {
  unlock: {
    heading: 'Sign in to unlock more',
    bullets: [
      'AI-powered album and artist summaries',
      'Personalized music recommendations',
      'Weekly listening insights',
      'Your listening stats and history',
      'Public profile page',
    ],
  },
  personal: {
    heading: 'Sign in with Last.fm for more',
    bullets: [
      'Your listening stats and history',
      'Weekly listening insights',
      'Recommendations based on what you play',
      'A public profile page',
    ],
  },
};

export function SignInCTA({ currentPath, variant = 'unlock' }: SignInCTAProps) {
  const loginUrl = `/login?next=${encodeURIComponent(currentPath)}`;
  const { heading, bullets } = CTA_COPY[variant];

  return (
    <div class="cta-box" style={{ maxWidth: '600px', marginTop: '2rem' }}>
      <h3 style={{ marginTop: '0' }}>{heading}</h3>
      <ul style={{ textAlign: 'left', margin: '1rem auto', maxWidth: '400px' }}>
        {bullets.map((bullet) => (
          <li>{bullet}</li>
        ))}
      </ul>
      <a href={loginUrl} class="button">Sign in with Last.fm</a>
    </div>
  );
}
