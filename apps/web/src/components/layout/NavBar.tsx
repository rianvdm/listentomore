// Navigation bar component with links and theme toggle
// Matches the navigation from the original my-music-next app

export function NavBar() {
  return (
    <nav class="nav">
      <div class="nav-container">
        <a href="/" class="nav-link nav-brand">
          Listen To More
        </a>

        <div class="nav-links">
          <a href="/artist" class="nav-link">
            Artists
          </a>
          <a href="/album" class="nav-link">
            Albums
          </a>
          <a href="/recommendations" class="nav-link">
            Get rec'd
          </a>
          <a href="/stats" class="nav-link">
            Stats
          </a>

          {/* More dropdown */}
          <div class="dropdown">
            <button class="dropdown-toggle" type="button" aria-haspopup="true">
              More ▾
            </button>
            <div class="dropdown-menu" role="menu">
              <a href="/playlist-cover" class="dropdown-item">
                Playlist Cover
              </a>
              <a href="/library" class="dropdown-item">
                Digital Library
              </a>
              <a href="/collection" class="dropdown-item">
                Discogs Collection
              </a>
              <a href="/collection/stats" class="dropdown-item">
                Collection Stats
              </a>
            </div>
          </div>

          <a href="/about" class="nav-link">
            About
          </a>
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
