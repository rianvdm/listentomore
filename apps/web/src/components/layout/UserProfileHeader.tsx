// User Profile Header - Static header that appears on all profile pages
// Provides consistent identity/context above the tab navigation

interface UserProfileHeaderProps {
  username: string;
  lastfmUsername: string;
}

export function UserProfileHeader({ username, lastfmUsername }: UserProfileHeaderProps) {
  return (
    <header class="profile-header">
      <h1>
        <a
          href={`https://www.last.fm/user/${lastfmUsername}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {username}
        </a>
      </h1>
      {/* Profile picture can be added here later:
      <div class="profile-picture">
        <img src={profileImage} alt={username} />
      </div>
      */}
    </header>
  );
}
