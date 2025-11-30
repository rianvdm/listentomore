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
          <a href="/album" class="nav-link">
            Albums
          </a>
          <a href="/artist" class="nav-link">
            Artists
          </a>
          <a href="/stats" class="nav-link">
            Stats
          </a>
          <a href="/discord" class="nav-link">
            Discord
          </a>
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
