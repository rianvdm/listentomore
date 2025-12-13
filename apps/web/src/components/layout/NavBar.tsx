// Navigation bar component with links and theme toggle

import type { User } from '@listentomore/db';

interface NavBarProps {
  currentUser?: User | null;
}

export function NavBar({ currentUser }: NavBarProps) {
  return (
    <nav class="nav">
      <div class="nav-container">
        <a href="/" class="nav-link nav-brand">
          Listen To More
        </a>

        <div class="nav-links">
          <a href="/album" class="nav-link">
            Albums
          </a>
          <a href="/artist" class="nav-link">
            Artists
          </a>
          <a href="/tools" class="nav-link">
            Tools
          </a>
          <a href="/about" class="nav-link">
            About
          </a>

          {currentUser ? (
            <div class="nav-user-menu">
              <button class="nav-user-button" id="user-menu-toggle" type="button">
                {currentUser.avatar_url ? (
                  <img
                    src={currentUser.avatar_url}
                    alt={currentUser.display_name || currentUser.lastfm_username || ''}
                    class="nav-avatar"
                  />
                ) : (
                  <span class="nav-avatar-placeholder">👤</span>
                )}
                <span class="nav-username">{currentUser.display_name || currentUser.lastfm_username}</span>
                <span class="nav-dropdown-arrow">▼</span>
              </button>
              <div class="nav-dropdown" id="user-dropdown">
                <a href={`/u/${currentUser.lastfm_username}`} class="nav-dropdown-item">
                  My Profile
                </a>
                <a href="/account" class="nav-dropdown-item">
                  Account Settings
                </a>
                <hr class="nav-dropdown-divider" />
                <a href="/auth/logout" class="nav-dropdown-item">
                  Sign Out
                </a>
              </div>
            </div>
          ) : (
            <a href="/login" class="nav-link nav-signin">
              Sign In
            </a>
          )}
        </div>

        <button
          id="theme-toggle"
          class="theme-toggle"
          type="button"
          aria-label="Toggle theme"
        >
          🌙
        </button>
      </div>
    </nav>
  );
}

export default NavBar;
