// ABOUTME: Tests for the privacy policy page copy.
// ABOUTME: Guards the claims that must stay true: what sign-in stores, the effective date, and the deletion link.

import { describe, it, expect } from 'vitest';
import { PrivacyPage, PRIVACY_EFFECTIVE_DATE } from '../../pages/legal/privacy';

describe('PrivacyPage', () => {
  const html = PrivacyPage({ currentUser: null }).toString();

  it('drops the claim that no personal information is collected', () => {
    expect(html).not.toContain('do not collect any personally identifiable information');
  });

  it('shows the new effective date', () => {
    expect(PRIVACY_EFFECTIVE_DATE).toBe('November 8, 2026');
    expect(html).toContain(PRIVACY_EFFECTIVE_DATE);
  });

  it('names what sign-in stores', () => {
    expect(html).toContain('Last.fm username');
    expect(html).toContain('IP address');
    expect(html).toContain('session key');
  });

  it('says session tokens are stored as a one-way hash', () => {
    expect(html).toContain('one-way hash');
  });

  it('explains deletion and links to the account page', () => {
    expect(html).toContain('href="/account"');
  });
});
