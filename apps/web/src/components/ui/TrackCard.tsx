// Track/Album card component for displaying music items in a grid

interface TrackCardProps {
  imageUrl?: string;
  artist: string;
  name: string;
  album?: string;
  playcount?: number;
  href?: string;
  subtitle?: string;
}

export function TrackCard({
  imageUrl,
  artist,
  name,
  album,
  playcount,
  href,
  subtitle,
}: TrackCardProps) {
  const content = (
    <div class="track">
      {imageUrl && (
        <img
          src={imageUrl}
          alt={`${name} by ${artist}`}
          class="track-image"
          loading="lazy"
          onerror="this.onerror=null;this.src='https://file.elezea.com/noun-no-image.png'"
        />
      )}
      <div class="track-content">
        <p class="track-artist">{artist}</p>
        <p class="track-name">{name}</p>
        {album && <p class="track-album">{album}</p>}
        {playcount !== undefined && (
          <p class="track-playcount">{playcount.toLocaleString()} plays</p>
        )}
        {subtitle && <p class="track-subtitle">{subtitle}</p>}
      </div>
    </div>
  );

  if (href) {
    return <a href={href}>{content}</a>;
  }

  return content;
}

export default TrackCard;
