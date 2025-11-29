// Database client and utilities for ListenToMore

export * from './schema';

import type {
  User,
  Search,
  RecentSearch,
  DiscogsSyncState,
  DiscogsRelease,
  RateLimit,
} from './schema';

// Database client wrapper
export class Database {
  constructor(private db: D1Database) {}

  // User queries
  async getUser(id: string = 'default'): Promise<User | null> {
    return this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(id)
      .first<User>();
  }

  async updateUser(
    id: string,
    data: Partial<Pick<User, 'email' | 'lastfm_username' | 'discogs_username' | 'spotify_connected'>>
  ): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.email !== undefined) {
      fields.push('email = ?');
      values.push(data.email);
    }
    if (data.lastfm_username !== undefined) {
      fields.push('lastfm_username = ?');
      values.push(data.lastfm_username);
    }
    if (data.discogs_username !== undefined) {
      fields.push('discogs_username = ?');
      values.push(data.discogs_username);
    }
    if (data.spotify_connected !== undefined) {
      fields.push('spotify_connected = ?');
      values.push(data.spotify_connected);
    }

    if (fields.length === 0) return;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    await this.db
      .prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  // Search history queries
  async recordSearch(data: {
    userId?: string;
    searchType: 'album' | 'artist';
    query: string;
    resultId?: string;
    resultName?: string;
    resultArtist?: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO searches (user_id, search_type, query, result_id, result_name, result_artist)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        data.userId || 'default',
        data.searchType,
        data.query,
        data.resultId || null,
        data.resultName || null,
        data.resultArtist || null
      )
      .run();
  }

  async getSearchHistory(userId: string = 'default', limit: number = 20): Promise<Search[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM searches WHERE user_id = ? ORDER BY searched_at DESC LIMIT ?`
      )
      .bind(userId, limit)
      .all<Search>();
    return result.results;
  }

  // Recent searches (community)
  async addRecentSearch(data: {
    spotifyId: string;
    albumName: string;
    artistName: string;
    imageUrl?: string;
  }): Promise<void> {
    // Check if album already exists
    const existing = await this.db
      .prepare('SELECT id FROM recent_searches WHERE spotify_id = ?')
      .bind(data.spotifyId)
      .first<{ id: string }>();

    if (existing) {
      // Update timestamp
      await this.db
        .prepare("UPDATE recent_searches SET searched_at = datetime('now') WHERE spotify_id = ?")
        .bind(data.spotifyId)
        .run();
    } else {
      // Insert new
      await this.db
        .prepare(
          `INSERT INTO recent_searches (spotify_id, album_name, artist_name, image_url)
           VALUES (?, ?, ?, ?)`
        )
        .bind(data.spotifyId, data.albumName, data.artistName, data.imageUrl || null)
        .run();

      // Keep only the last 9
      await this.db
        .prepare(
          `DELETE FROM recent_searches WHERE id NOT IN (
            SELECT id FROM recent_searches ORDER BY searched_at DESC LIMIT 9
          )`
        )
        .run();
    }
  }

  async getRecentSearches(limit: number = 9): Promise<RecentSearch[]> {
    const result = await this.db
      .prepare('SELECT * FROM recent_searches ORDER BY searched_at DESC LIMIT ?')
      .bind(limit)
      .all<RecentSearch>();
    return result.results;
  }

  // Discogs sync state
  async getSyncState(id: string = 'default'): Promise<DiscogsSyncState | null> {
    return this.db
      .prepare('SELECT * FROM discogs_sync_state WHERE id = ?')
      .bind(id)
      .first<DiscogsSyncState>();
  }

  async updateSyncState(
    id: string,
    data: Partial<
      Pick<
        DiscogsSyncState,
        | 'status'
        | 'current_page'
        | 'total_pages'
        | 'enrichment_cursor'
        | 'last_full_sync'
        | 'last_enrichment_sync'
        | 'error_message'
      >
    >
  ): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.status !== undefined) {
      fields.push('status = ?');
      values.push(data.status);
    }
    if (data.current_page !== undefined) {
      fields.push('current_page = ?');
      values.push(data.current_page);
    }
    if (data.total_pages !== undefined) {
      fields.push('total_pages = ?');
      values.push(data.total_pages);
    }
    if (data.enrichment_cursor !== undefined) {
      fields.push('enrichment_cursor = ?');
      values.push(data.enrichment_cursor);
    }
    if (data.last_full_sync !== undefined) {
      fields.push('last_full_sync = ?');
      values.push(data.last_full_sync);
    }
    if (data.last_enrichment_sync !== undefined) {
      fields.push('last_enrichment_sync = ?');
      values.push(data.last_enrichment_sync);
    }
    if (data.error_message !== undefined) {
      fields.push('error_message = ?');
      values.push(data.error_message);
    }

    if (fields.length === 0) return;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    await this.db
      .prepare(`UPDATE discogs_sync_state SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  // Discogs releases
  async upsertRelease(release: Omit<DiscogsRelease, 'created_at' | 'updated_at'>): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO discogs_releases (
          id, user_id, instance_id, title, artist, year, original_year,
          format, label, genres, styles, master_genres, master_styles,
          image_url, discogs_url, date_added, rating, master_id, master_enriched
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          instance_id = excluded.instance_id,
          title = excluded.title,
          artist = excluded.artist,
          year = excluded.year,
          original_year = COALESCE(excluded.original_year, discogs_releases.original_year),
          format = excluded.format,
          label = excluded.label,
          genres = excluded.genres,
          styles = excluded.styles,
          master_genres = COALESCE(excluded.master_genres, discogs_releases.master_genres),
          master_styles = COALESCE(excluded.master_styles, discogs_releases.master_styles),
          image_url = excluded.image_url,
          discogs_url = excluded.discogs_url,
          date_added = excluded.date_added,
          rating = excluded.rating,
          master_id = excluded.master_id,
          master_enriched = CASE WHEN excluded.master_genres IS NOT NULL THEN 1 ELSE discogs_releases.master_enriched END,
          updated_at = datetime('now')`
      )
      .bind(
        release.id,
        release.user_id,
        release.instance_id,
        release.title,
        release.artist,
        release.year,
        release.original_year,
        release.format,
        release.label,
        release.genres,
        release.styles,
        release.master_genres,
        release.master_styles,
        release.image_url,
        release.discogs_url,
        release.date_added,
        release.rating,
        release.master_id,
        release.master_enriched
      )
      .run();
  }

  async getReleases(
    userId: string = 'default',
    options: {
      limit?: number;
      offset?: number;
      orderBy?: 'date_added' | 'artist' | 'year';
      orderDir?: 'ASC' | 'DESC';
    } = {}
  ): Promise<DiscogsRelease[]> {
    const { limit = 50, offset = 0, orderBy = 'date_added', orderDir = 'DESC' } = options;
    const result = await this.db
      .prepare(
        `SELECT * FROM discogs_releases WHERE user_id = ?
         ORDER BY ${orderBy} ${orderDir} LIMIT ? OFFSET ?`
      )
      .bind(userId, limit, offset)
      .all<DiscogsRelease>();
    return result.results;
  }

  async getReleasesNeedingEnrichment(limit: number = 100): Promise<DiscogsRelease[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM discogs_releases
         WHERE master_enriched = 0 AND master_id IS NOT NULL
         LIMIT ?`
      )
      .bind(limit)
      .all<DiscogsRelease>();
    return result.results;
  }

  async getReleaseCount(userId: string = 'default'): Promise<number> {
    const result = await this.db
      .prepare('SELECT COUNT(*) as count FROM discogs_releases WHERE user_id = ?')
      .bind(userId)
      .first<{ count: number }>();
    return result?.count ?? 0;
  }

  // Rate limits
  async getRateLimit(service: RateLimit['service']): Promise<RateLimit | null> {
    return this.db
      .prepare('SELECT * FROM rate_limits WHERE service = ?')
      .bind(service)
      .first<RateLimit>();
  }

  async updateRateLimit(
    service: RateLimit['service'],
    data: { requestsRemaining: number; windowResetAt?: string }
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE rate_limits
         SET requests_remaining = ?, window_reset_at = ?, updated_at = datetime('now')
         WHERE service = ?`
      )
      .bind(data.requestsRemaining, data.windowResetAt || null, service)
      .run();
  }
}
