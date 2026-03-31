// User Profile Header - Static header that appears on all profile pages
// Provides consistent identity/context above the tab navigation

interface UserProfileHeaderProps {
  username: string;
  lastfmUsername: string;
  profileImage?: string;
  bio?: string | null;
}

export function UserProfileHeader({ username, lastfmUsername, profileImage, bio }: UserProfileHeaderProps) {
  return (
    <header class="profile-header">
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '1rem', textAlign: 'left' }}>
        {profileImage && (
          <img
            src={profileImage}
            alt={username}
            width={64}
            height={64}
            style={{
              borderRadius: '50%',
              objectFit: 'cover',
              flexShrink: 0,
            }}
          />
        )}
        <div>
          <h1>
            <a
              href={`https://www.last.fm/user/${lastfmUsername}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {username}
            </a>
          </h1>
          {bio && (
            <p style={{ margin: '0.25rem 0 0', color: 'var(--c-muted)', fontSize: '0.95rem' }}>
              {bio}
            </p>
          )}
        </div>
      </div>
    </header>
  );
}
