// Database client and utilities for ListenToMore

export * from './schema';

import type {
  User,
  Search,
  RecentSearch,
  DiscogsSyncState,
  DiscogsRelease,
  RateLimit,
  ApiKey,
  ApiKeyTier,
  ApiKeyScope,
  ParsedApiKey,
  OAuthToken,
  OAuthProvider,
} from './schema';
import { parseApiKey, TIER_RATE_LIMITS } from './schema';

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

  async getUserByUsername(username: string): Promise<User | null> {
    return this.db
      .prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)')
      .bind(username)
      .first<User>();
  }

  async getUserByLastfmUsername(lastfmUsername: string): Promise<User | null> {
    return this.db
      .prepare('SELECT * FROM users WHERE LOWER(lastfm_username) = LOWER(?)')
      .bind(lastfmUsername)
      .first<User>();
  }

  async getAllUsersWithLastfm(): Promise<User[]> {
    const result = await this.db
      .prepare('SELECT * FROM users WHERE lastfm_username IS NOT NULL')
      .all<User>();
    return result.results;
  }

  async getUsersWithDiscogs(): Promise<User[]> {
    const result = await this.db
      .prepare('SELECT * FROM users WHERE discogs_username IS NOT NULL')
      .all<User>();
    return result.results;
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

  // API Key management

  /**
   * Create a new API key
   * Returns the raw key (only returned once!) and the stored record
   */
  async createApiKey(data: {
    userId?: string;
    name?: string;
    tier?: ApiKeyTier;
    scopes?: ApiKeyScope[];
    rateLimitRpm?: number;
    expiresAt?: string;
  }): Promise<{ key: string; record: ParsedApiKey }> {
    // Generate a random key: ltm_<32 random hex chars>
    const randomBytes = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);
    const randomHex = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const rawKey = `ltm_${randomHex}`;
    const keyPrefix = rawKey.substring(0, 8);

    // Hash the key for storage
    const encoder = new TextEncoder();
    const keyData = encoder.encode(rawKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const keyHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    const tier = data.tier || 'standard';
    const scopes = JSON.stringify(data.scopes || ['read']);

    const result = await this.db
      .prepare(
        `INSERT INTO api_keys (user_id, key_hash, key_prefix, name, tier, scopes, rate_limit_rpm, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`
      )
      .bind(
        data.userId || null,
        keyHash,
        keyPrefix,
        data.name || 'Default',
        tier,
        scopes,
        data.rateLimitRpm || null,
        data.expiresAt || null
      )
      .first<ApiKey>();

    if (!result) {
      throw new Error('Failed to create API key');
    }

    return {
      key: rawKey,
      record: parseApiKey(result),
    };
  }

  /**
   * Validate an API key and return the parsed record if valid
   * Also updates last_used_at timestamp
   */
  async validateApiKey(rawKey: string): Promise<ParsedApiKey | null> {
    // Hash the provided key
    const encoder = new TextEncoder();
    const keyData = encoder.encode(rawKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const keyHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    // Look up by hash
    const apiKey = await this.db
      .prepare(
        `SELECT * FROM api_keys
         WHERE key_hash = ?
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > datetime('now'))`
      )
      .bind(keyHash)
      .first<ApiKey>();

    if (!apiKey) {
      return null;
    }

    // Update last_used_at (fire and forget)
    this.db
      .prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?")
      .bind(apiKey.id)
      .run();

    return parseApiKey(apiKey);
  }

  /**
   * Get API key by ID (for management purposes)
   */
  async getApiKey(id: string): Promise<ParsedApiKey | null> {
    const apiKey = await this.db
      .prepare('SELECT * FROM api_keys WHERE id = ?')
      .bind(id)
      .first<ApiKey>();

    return apiKey ? parseApiKey(apiKey) : null;
  }

  /**
   * List API keys for a user
   */
  async listApiKeys(userId: string): Promise<ParsedApiKey[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM api_keys
         WHERE user_id = ? AND revoked_at IS NULL
         ORDER BY created_at DESC`
      )
      .bind(userId)
      .all<ApiKey>();

    return result.results.map(parseApiKey);
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(id: string): Promise<void> {
    await this.db
      .prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?")
      .bind(id)
      .run();
  }

  /**
   * Increment request count for an API key
   */
  async incrementApiKeyUsage(id: string): Promise<void> {
    await this.db
      .prepare('UPDATE api_keys SET request_count = request_count + 1 WHERE id = ?')
      .bind(id)
      .run();
  }

  /**
   * Log API usage for analytics
   */
  async logApiUsage(data: {
    apiKeyId?: string;
    endpoint: string;
    method?: string;
    statusCode?: number;
    ipAddress?: string;
    userAgent?: string;
    responseTimeMs?: number;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO api_usage_log (api_key_id, endpoint, method, status_code, ip_address, user_agent, response_time_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        data.apiKeyId || null,
        data.endpoint,
        data.method || 'GET',
        data.statusCode || null,
        data.ipAddress || null,
        data.userAgent || null,
        data.responseTimeMs || null
      )
      .run();
  }

  /**
   * Get the effective rate limit for an API key (or default tier limit)
   */
  getEffectiveRateLimit(apiKey: ParsedApiKey | null): number {
    if (!apiKey) {
      return TIER_RATE_LIMITS.public;
    }
    return apiKey.rate_limit_rpm ?? TIER_RATE_LIMITS[apiKey.tier];
  }

  // ============================================================================
  // OAuth Token Methods
  // ============================================================================

  /**
   * Store or update an OAuth token for a user/provider
   */
  async storeOAuthToken(data: {
    userId: string;
    provider: OAuthProvider;
    accessToken: string; // Already encrypted
    refreshToken?: string; // Already encrypted (token secret for OAuth 1.0a)
    tokenType?: string;
    scope?: string;
    expiresAt?: string;
    providerUserId?: string;
    providerUsername?: string;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO oauth_tokens (
          user_id, provider, access_token_encrypted, refresh_token_encrypted,
          token_type, scope, expires_at, provider_user_id, provider_username
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, provider) DO UPDATE SET
          access_token_encrypted = excluded.access_token_encrypted,
          refresh_token_encrypted = excluded.refresh_token_encrypted,
          token_type = excluded.token_type,
          scope = excluded.scope,
          expires_at = excluded.expires_at,
          provider_user_id = excluded.provider_user_id,
          provider_username = excluded.provider_username,
          updated_at = datetime('now')`
      )
      .bind(
        data.userId,
        data.provider,
        data.accessToken,
        data.refreshToken || null,
        data.tokenType || 'Bearer',
        data.scope || null,
        data.expiresAt || null,
        data.providerUserId || null,
        data.providerUsername || null
      )
      .run();
  }

  /**
   * Get OAuth token for a user/provider
   */
  async getOAuthToken(userId: string, provider: OAuthProvider): Promise<OAuthToken | null> {
    return this.db
      .prepare('SELECT * FROM oauth_tokens WHERE user_id = ? AND provider = ?')
      .bind(userId, provider)
      .first<OAuthToken>();
  }

  /**
   * Delete OAuth token for a user/provider
   */
  async deleteOAuthToken(userId: string, provider: OAuthProvider): Promise<void> {
    await this.db
      .prepare('DELETE FROM oauth_tokens WHERE user_id = ? AND provider = ?')
      .bind(userId, provider)
      .run();
  }
}
