// Dismissible announcement banner
// Configuration lives in @listentomore/config (BANNER_CONFIG)

import { BANNER_CONFIG } from '@listentomore/config';

export function Banner() {
  if (!BANNER_CONFIG.enabled) return null;

  return (
    <div id="announcement-banner" class="banner" data-banner-id={BANNER_CONFIG.id} data-expires={BANNER_CONFIG.expiresAt ?? ''} style="display:none">
      <div class="banner-content">
        <span class="banner-message">
          {BANNER_CONFIG.message}
          {BANNER_CONFIG.link && (
            <>
              {' '}
              <a href={BANNER_CONFIG.link.url} target="_blank" rel="noopener noreferrer">
                {BANNER_CONFIG.link.text} →
              </a>
            </>
          )}
        </span>
        <button class="banner-dismiss" aria-label="Dismiss announcement" title="Dismiss">×</button>
      </div>
    </div>
  );
}
