// User profile subnavigation component
// Displays tabs for navigating between user profile pages

interface UserProfileNavProps {
  username: string;
  activePage: 'stats' | 'recommendations' | 'insights';
}

export function UserProfileNav({ username, activePage }: UserProfileNavProps) {
  return (
    <nav class="profile-nav">
      <a
        href={`/u/${username}`}
        class={`profile-nav-link${activePage === 'stats' ? ' active' : ''}`}
      >
        Stats
      </a>
      <a
        href={`/u/${username}/recommendations`}
        class={`profile-nav-link${activePage === 'recommendations' ? ' active' : ''}`}
      >
        Recommendations
      </a>
      <a
        href={`/u/${username}/insights`}
        class={`profile-nav-link${activePage === 'insights' ? ' active' : ''}`}
      >
        Insights
      </a>
    </nav>
  );
}
