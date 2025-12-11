// Account Discogs page - manage Discogs connection and view collection stats
// URL: /account/discogs

import type { Context } from 'hono';
import { Layout } from '../../components/layout';
import type { Database } from '@listentomore/db';

interface AccountDiscogsPageProps {
  username: string;
  discogsUsername: string | null;
  internalToken?: string;
}

export function AccountDiscogsPage({
  username,
  discogsUsername,
  internalToken,
}: AccountDiscogsPageProps) {
  return (
    <Layout
      title="Discogs Collection"
      description="Manage your Discogs connection and view collection statistics"
      url="https://listentomore.com/account/discogs"
      internalToken={internalToken}
    >
      <header>
        <h1>📀 Vinyl Collection</h1>
        <p class="text-center">
          <a href={`/u/${username}`}>← Back to {username}'s stats</a>
        </p>
      </header>

      <main>
        {/* Connection Status Section */}
        <section id="discogs-connection">
          <h2>Connection Status</h2>
          {discogsUsername ? (
            <div class="track_ul2">
              <p>
                <strong>✓ Connected to Discogs as </strong>
                <a
                  href={`https://www.discogs.com/user/${discogsUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {discogsUsername}
                </a>
              </p>
              <p class="text-muted" style={{ marginTop: '0.5rem' }}>
                Your vinyl collection is synced with ListenToMore.
              </p>
              <p style={{ marginTop: '1rem' }}>
                <button id="disconnect-btn" class="button-secondary">
                  Disconnect Discogs
                </button>
              </p>
            </div>
          ) : (
            <div class="track_ul2 text-center">
              <p class="text-muted">
                Connect your Discogs account to see your vinyl collection stats.
              </p>
              <p style={{ marginTop: '1rem' }}>
                <a
                  href={`/api/auth/discogs/connect?username=${username}`}
                  class="button"
                >
                  Connect Discogs →
                </a>
              </p>
            </div>
          )}
        </section>

        {/* Collection Stats Section - only show if connected */}
        {discogsUsername && (
          <section id="discogs-stats" style={{ marginTop: '3rem' }}>
            <h2>Collection Statistics</h2>
            <div id="discogs-collection-stats">
              <div class="loading-container">
                <span class="spinner">↻</span>
                <span class="loading-text">Loading collection stats...</span>
              </div>
            </div>

            {/* Sync Button */}
            <div id="sync-section" style={{ marginTop: '2rem' }}>
              <p class="text-center">
                <button id="sync-collection-btn" class="button-secondary">
                  Sync Collection Now
                </button>
              </p>
              <p
                id="sync-status"
                class="text-muted text-center"
                style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}
              ></p>
            </div>

            {/* Enrichment Section */}
            <div
              id="enrichment-section"
              style={{
                marginTop: '2rem',
                padding: '1.5rem',
                background: 'var(--bg-secondary)',
                borderRadius: '8px',
              }}
            >
              <h3 style={{ marginTop: 0 }}>Master Release Data</h3>
              <p class="text-muted" style={{ fontSize: '0.9rem' }}>
                Enrichment fetches original release year and additional genre/style data from
                Discogs master releases. This improves filtering accuracy.
              </p>
              <div id="enrichment-status">
                <p class="text-muted">
                  <span class="loading-inline">Checking enrichment status...</span>
                </p>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Client-side scripts */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
        (function() {
          var username = ${JSON.stringify(username)};
          var discogsUsername = ${JSON.stringify(discogsUsername)};

          // Disconnect button handler
          var disconnectBtn = document.getElementById('disconnect-btn');
          if (disconnectBtn) {
            disconnectBtn.addEventListener('click', function() {
              if (!confirm('Are you sure you want to disconnect your Discogs account? Your collection data will be removed.')) {
                return;
              }

              var btn = this;
              btn.disabled = true;
              btn.textContent = 'Disconnecting...';

              fetch('/api/auth/discogs/disconnect?username=' + encodeURIComponent(username), { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function(result) {
                  if (result.error) {
                    alert('Failed to disconnect: ' + result.error);
                    btn.disabled = false;
                    btn.textContent = 'Disconnect Discogs';
                  } else {
                    alert('Discogs disconnected successfully. Refreshing page...');
                    window.location.reload();
                  }
                })
                .catch(function(err) {
                  alert('Failed to disconnect: ' + err.message);
                  btn.disabled = false;
                  btn.textContent = 'Disconnect Discogs';
                });
            });
          }

          // Only load stats if connected
          if (!discogsUsername) return;

          // Fetch collection stats
          var statsEl = document.getElementById('discogs-collection-stats');
          if (statsEl) {
            internalFetch('/api/internal/discogs-stats?username=' + encodeURIComponent(username))
              .then(function(r) { return r.json(); })
              .then(function(result) {
                if (result.error) {
                  statsEl.innerHTML = '<p class="text-muted">' + result.error + '</p>';
                  return;
                }

                var stats = result.data.stats;
                var html = '<div class="stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin: 2rem 0;">';
                
                // Total Records
                html += '<div class="stat-card" style="text-align: center; padding: 1.5rem; background: var(--bg-secondary); border-radius: 8px;">';
                html += '<div style="font-size: 2.5rem; font-weight: bold; color: var(--accent-color);">' + stats.totalItems + '</div>';
                html += '<div style="color: var(--text-muted);">Total Records</div></div>';
                
                // Artists
                html += '<div class="stat-card" style="text-align: center; padding: 1.5rem; background: var(--bg-secondary); border-radius: 8px;">';
                html += '<div style="font-size: 2.5rem; font-weight: bold; color: var(--accent-color);">' + stats.uniqueArtists + '</div>';
                html += '<div style="color: var(--text-muted);">Artists</div></div>';
                
                // Genres
                html += '<div class="stat-card" style="text-align: center; padding: 1.5rem; background: var(--bg-secondary); border-radius: 8px;">';
                html += '<div style="font-size: 2.5rem; font-weight: bold; color: var(--accent-color);">' + stats.uniqueGenres.length + '</div>';
                html += '<div style="color: var(--text-muted);">Genres</div></div>';
                
                // Year Range
                html += '<div class="stat-card" style="text-align: center; padding: 1.5rem; background: var(--bg-secondary); border-radius: 8px;">';
                var yearRange = (stats.earliestYear && stats.latestYear) ? stats.earliestYear + '-' + stats.latestYear : 'N/A';
                html += '<div style="font-size: 1.8rem; font-weight: bold; color: var(--accent-color);">' + yearRange + '</div>';
                html += '<div style="color: var(--text-muted);">Year Range</div></div>';
                
                html += '</div>';

                // Top Genres
                var topGenres = Object.entries(stats.genreCounts || {}).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 5);
                if (topGenres.length > 0) {
                  html += '<div style="margin-top: 2rem;">';
                  html += '<h3>Top Genres</h3>';
                  html += '<ul style="columns: 2; column-gap: 2rem;">';
                  topGenres.forEach(function(g) { 
                    html += '<li><strong>' + g[0] + '</strong> <span class="text-muted">(' + g[1] + ')</span></li>'; 
                  });
                  html += '</ul></div>';
                }

                // Formats
                var topFormats = Object.entries(stats.formatCounts || {}).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 5);
                if (topFormats.length > 0) {
                  html += '<div style="margin-top: 1.5rem;">';
                  html += '<h3>Formats</h3>';
                  html += '<ul style="columns: 2; column-gap: 2rem;">';
                  topFormats.forEach(function(f) { 
                    html += '<li><strong>' + f[0] + '</strong> <span class="text-muted">(' + f[1] + ')</span></li>'; 
                  });
                  html += '</ul></div>';
                }

                // Last synced
                html += '<p class="text-muted" style="margin-top: 2rem; font-size: 0.9rem;">Last synced: ' + new Date(result.data.lastSynced).toLocaleString() + '</p>';

                statsEl.innerHTML = html;
              })
              .catch(function(e) {
                console.error('Discogs stats error:', e);
                statsEl.innerHTML = '<p class="text-muted">Failed to load collection stats.</p>';
              });
          }

          // Sync button handler
          var syncBtn = document.getElementById('sync-collection-btn');
          var syncStatus = document.getElementById('sync-status');
          if (syncBtn) {
            syncBtn.addEventListener('click', function() {
              var btn = this;
              btn.disabled = true;
              btn.textContent = 'Syncing... (this may take 30-60 seconds)';
              if (syncStatus) syncStatus.textContent = '';

              internalFetch('/api/internal/discogs-sync?username=' + encodeURIComponent(username), { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function(result) {
                  if (result.error) {
                    if (syncStatus) syncStatus.textContent = result.error;
                    btn.disabled = false;
                    btn.textContent = 'Sync Collection Now';
                  } else {
                    alert('Collection synced successfully! ' + result.data.releaseCount + ' releases. Refreshing page...');
                    window.location.reload();
                  }
                })
                .catch(function(err) {
                  if (syncStatus) syncStatus.textContent = 'Sync failed: ' + err.message;
                  btn.disabled = false;
                  btn.textContent = 'Sync Collection Now';
                });
            });
          }

          // Enrichment status and controls
          var enrichmentStatusEl = document.getElementById('enrichment-status');
          if (enrichmentStatusEl) {
            loadEnrichmentStatus();
          }

          function loadEnrichmentStatus() {
            internalFetch('/api/internal/discogs-enrichment-status?username=' + encodeURIComponent(username))
              .then(function(r) { return r.json(); })
              .then(function(result) {
                if (result.error) {
                  enrichmentStatusEl.innerHTML = '<p class="text-muted">' + result.error + '</p>';
                  return;
                }

                var data = result.data;
                var html = '';

                // Show counts
                html += '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin: 1rem 0; text-align: center;">';
                html += '<div><strong>' + data.alreadyEnriched + '</strong><br><span class="text-muted" style="font-size: 0.85rem;">Enriched</span></div>';
                html += '<div><strong>' + data.needsEnrichment + '</strong><br><span class="text-muted" style="font-size: 0.85rem;">Pending</span></div>';
                html += '<div><strong>' + data.noMasterId + '</strong><br><span class="text-muted" style="font-size: 0.85rem;">No Master</span></div>';
                html += '</div>';

                // Show progress if running
                if (data.progress && data.progress.status === 'running') {
                  var pct = Math.round((data.progress.processed / data.progress.total) * 100);
                  html += '<div style="margin: 1rem 0;">';
                  html += '<div style="background: var(--bg-primary); border-radius: 4px; height: 8px; overflow: hidden;">';
                  html += '<div style="background: var(--accent-color); height: 100%; width: ' + pct + '%;"></div>';
                  html += '</div>';
                  html += '<p class="text-muted" style="font-size: 0.85rem; margin-top: 0.5rem;">';
                  html += 'Processing: ' + (data.progress.currentRelease || '...') + ' (' + pct + '%)';
                  html += '</p></div>';
                }

                // Show enrich button if needed
                if (data.needsEnrichment > 0) {
                  html += '<p style="margin-top: 1rem;">';
                  html += '<button id="enrich-btn" class="button-secondary">';
                  html += data.progress && data.progress.status === 'running' ? 'Continue Enrichment' : 'Start Enrichment';
                  html += '</button>';
                  html += '</p>';
                  html += '<p id="enrich-status" class="text-muted" style="font-size: 0.85rem;"></p>';
                } else if (data.alreadyEnriched > 0) {
                  html += '<p style="color: var(--accent-color); margin-top: 1rem;">✓ All releases enriched!</p>';
                }

                enrichmentStatusEl.innerHTML = html;

                // Attach enrich button handler
                var enrichBtn = document.getElementById('enrich-btn');
                if (enrichBtn) {
                  enrichBtn.addEventListener('click', startEnrichment);
                }
              })
              .catch(function(e) {
                console.error('Enrichment status error:', e);
                enrichmentStatusEl.innerHTML = '<p class="text-muted">Failed to load enrichment status.</p>';
              });
          }

          // Track if enrichment is running to prevent interference
          var isEnrichmentRunning = false;

          function startEnrichment() {
            var enrichBtn = document.getElementById('enrich-btn');
            var enrichStatus = document.getElementById('enrich-status');
            if (!enrichBtn || isEnrichmentRunning) return;

            isEnrichmentRunning = true;
            enrichBtn.disabled = true;
            enrichBtn.textContent = 'Enriching... (this takes ~1 min per batch)';
            if (enrichStatus) enrichStatus.textContent = 'Starting enrichment...';

            runEnrichmentBatch();
          }

          function runEnrichmentBatch() {
            console.log('[Enrichment] Starting batch...');
            
            internalFetch('/api/internal/discogs-enrich?username=' + encodeURIComponent(username), { method: 'POST' })
              .then(function(r) { return r.json(); })
              .then(function(result) {
                var enrichBtn = document.getElementById('enrich-btn');
                var enrichStatus = document.getElementById('enrich-status');
                
                console.log('[Enrichment] Batch result:', result);

                if (result.error) {
                  console.error('[Enrichment] Error:', result.error);
                  if (enrichStatus) enrichStatus.textContent = 'Error: ' + result.error;
                  if (enrichBtn) {
                    enrichBtn.disabled = false;
                    enrichBtn.textContent = 'Retry Enrichment';
                  }
                  isEnrichmentRunning = false;
                  return;
                }

                var data = result.data;
                if (enrichStatus) {
                  enrichStatus.textContent = data.message;
                }

                // Check if enrichment was queued for background processing
                if (data.queued) {
                  console.log('[Enrichment] Queued for background processing');
                  if (enrichBtn) {
                    enrichBtn.textContent = 'Processing in background...';
                    enrichBtn.disabled = true;
                  }
                  isEnrichmentRunning = false;
                  // Start polling for status updates
                  startBackgroundPolling();
                  return;
                }

                // If more remaining (inline mode), automatically continue
                if (data.remaining > 0 && !data.queued) {
                  console.log('[Enrichment] ' + data.remaining + ' remaining, continuing in 2s...');
                  if (enrichBtn) {
                    enrichBtn.textContent = 'Enriching... (' + data.remaining + ' remaining)';
                  }
                  // Continue with next batch after a short delay
                  setTimeout(runEnrichmentBatch, 2000);
                } else {
                  console.log('[Enrichment] Complete!');
                  isEnrichmentRunning = false;
                  // Refresh status to show completion
                  loadEnrichmentStatus();
                }
              })
              .catch(function(err) {
                console.error('[Enrichment] Fetch error:', err);
                var enrichBtn = document.getElementById('enrich-btn');
                var enrichStatus = document.getElementById('enrich-status');
                if (enrichStatus) enrichStatus.textContent = 'Failed: ' + err.message;
                if (enrichBtn) {
                  enrichBtn.disabled = false;
                  enrichBtn.textContent = 'Retry Enrichment';
                }
                isEnrichmentRunning = false;
              });
          }

          // Poll for background enrichment progress
          var backgroundPollInterval = null;
          function startBackgroundPolling() {
            if (backgroundPollInterval) return;
            
            console.log('[Enrichment] Starting background polling...');
            backgroundPollInterval = setInterval(function() {
              internalFetch('/api/internal/discogs-enrichment-status?username=' + encodeURIComponent(username))
                .then(function(r) { return r.json(); })
                .then(function(result) {
                  if (result.error) return;
                  
                  var data = result.data;
                  var enrichBtn = document.getElementById('enrich-btn');
                  var enrichStatus = document.getElementById('enrich-status');
                  
                  // Update status display
                  if (enrichStatus) {
                    var statusText = 'Background: ' + data.alreadyEnriched + ' enriched';
                    if (data.needsEnrichment > 0) {
                      statusText += ', ' + data.needsEnrichment + ' remaining...';
                    } else {
                      statusText = '✓ All releases enriched!';
                    }
                    enrichStatus.textContent = statusText;
                  }
                  
                  // Check if complete
                  if (data.needsEnrichment === 0) {
                    console.log('[Enrichment] Background processing complete!');
                    clearInterval(backgroundPollInterval);
                    backgroundPollInterval = null;
                    loadEnrichmentStatus(); // Refresh full status
                  }
                })
                .catch(function(err) {
                  console.error('[Enrichment] Poll error:', err);
                });
            }, 10000); // Poll every 10 seconds
          }
        })();
      `,
        }}
      />
    </Layout>
  );
}

// 404 page for user not found
function UserNotFound({ username }: { username: string }) {
  return (
    <Layout title="User Not Found">
      <div class="text-center" style={{ paddingTop: '4rem' }}>
        <h1 style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>User not found</h1>
        <p>
          No user with username "<strong>{username}</strong>" exists in our system.
        </p>
        <p class="mt-2">
          <a href="/" class="button">
            Go Home
          </a>
        </p>
      </div>
    </Layout>
  );
}

// Route handler
export async function handleAccountDiscogs(c: Context) {
  const username = c.req.param('username');
  const db = c.get('db') as Database;
  const internalToken = c.get('internalToken') as string;

  // Look up user by username or lastfm_username (fallback for local dev)
  let user = await db.getUserByLastfmUsername(username);
  if (!user) {
    user = await db.getUserByUsername(username);
  }

  if (!user || !user.lastfm_username) {
    return c.html(<UserNotFound username={username} />, 404);
  }

  return c.html(
    <AccountDiscogsPage
      username={user.username || user.lastfm_username}
      discogsUsername={user.discogs_username}
      internalToken={internalToken}
    />
  );
}
