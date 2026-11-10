// ABOUTME: Sign-in call-to-action component for feature gating.
// ABOUTME: Shared by SignInGate (per-section) and requireAuthPage (full-page) patterns.

import type { Ref } from '../../utils/referral';

export type SignInCTAVariant = 'unlock' | 'personal' | 'lastfm-mcp';
type SignInCTAEntity = 'album' | 'artist';

export interface SignInCTAProps {
  currentPath: string;
  // 'personal' is for pages that already show a public AI summary, so it pitches only signed-in features.
  // 'lastfm-mcp' speaks to visitors who arrived from lastfm-mcp and so already use Last.fm.
  variant?: SignInCTAVariant;
  // The page the 'lastfm-mcp' summary bullet names.
  entity?: SignInCTAEntity;
  // The page rendered a cached AI summary, so 'lastfm-mcp' leaves the summary out of its pitch.
  summaryShown?: boolean;
  // A validated referrer, carried into /login so it can be attributed after sign-in.
  signInRef?: Ref;
}

interface CTACopy {
  heading: string;
  intro?: string;
  bullets: string[];
}

function getCopy(variant: SignInCTAVariant, entity: SignInCTAEntity, summaryShown: boolean): CTACopy {
  switch (variant) {
    case 'unlock':
      return {
        heading: 'Sign in to unlock more',
        bullets: [
          'AI-powered album and artist summaries',
          'Personalized music recommendations',
          'Weekly listening insights',
          'Your listening stats and history',
          'Public profile page',
        ],
      };
    case 'personal':
      return {
        heading: 'Sign in with Last.fm for more',
        bullets: [
          'Your listening stats and history',
          'Weekly listening insights',
          'Recommendations based on what you play',
          'A public profile page',
        ],
      };
    case 'lastfm-mcp':
      return {
        heading: 'You already use Last.fm',
        intro: 'Sign in with it to get more from ListenToMore:',
        bullets: summaryShown
          ? [
              'Recommendations based on what you play',
              'Your listening stats and weekly insights',
              'A public profile page',
            ]
          : [
              `The AI summary of this ${entity}`,
              'Recommendations based on what you play',
              'Your listening stats and weekly insights',
            ],
      };
  }
}

export function SignInCTA({
  currentPath,
  variant = 'unlock',
  entity = 'album',
  summaryShown = false,
  signInRef,
}: SignInCTAProps) {
  const refParam = signInRef ? `&ref=${encodeURIComponent(signInRef)}` : '';
  const loginUrl = `/login?next=${encodeURIComponent(currentPath)}${refParam}`;
  const { heading, intro, bullets } = getCopy(variant, entity, summaryShown);

  return (
    <div class="cta-box" style={{ maxWidth: '600px', marginTop: '2rem' }}>
      <h3 style={{ marginTop: '0' }}>{heading}</h3>
      {intro && <p>{intro}</p>}
      <ul style={{ textAlign: 'left', margin: '1rem auto', maxWidth: '400px' }}>
        {bullets.map((bullet) => (
          <li>{bullet}</li>
        ))}
      </ul>
      <a href={loginUrl} class="button">Sign in with Last.fm</a>
    </div>
  );
}
