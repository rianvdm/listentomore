// ABOUTME: Read-only before/after measurement of the request-path metrics touched by the perf/spotify-miss-path deploy.
// ABOUTME: Queries Workers Observability through the cf CLI (plus one D1 SELECT), writes raw JSON, prints a markdown summary.
//
// Usage (Node 22, from apps/web, cf CLI logged in):
//   node scripts/perf-metrics.mjs --label before --to 1793020158564
//   node scripts/perf-metrics.mjs --label after --to now --out ../../perf/after.json
//   node scripts/perf-metrics.mjs --label early-after --from 1793022335000 --to now
//
// Flags:
//   --to <epoch-ms|now>  End of every window (default now). Windows are 24h and 7d ending here.
//   --from <epoch-ms>    Replace both windows with [from, to], e.g. for an early read since a deploy.
//   --label <name>       Free-form label, usually before or after (default adhoc).
//   --out <file>         Output JSON path (default ./<label>-<to>.json).
//   --skip-d1            Skip the read-only api_usage_log SELECT (metric 6, D1 side).
//
// Everything is read-only: telemetry queries, `cf o11y issues list`, and one
// `wrangler d1 execute --remote` SELECT. The cf CLI runs from a fresh temp
// directory so a stray .env cannot override the account.
//
// Sampling: the events and calculations views are ABR-sampled on long windows.
// Every pull starts from 6h (events) or one UTC day (counts) and halves a window
// until the response reports abr_level 1 and the events page is not full, so all
// numbers are exact counts over complete data. Percentiles use linear
// interpolation over the raw values (same as the 2026-10-25 investigation).
//
// Metric 1 hit/miss: a trace is a miss when it contains a fetch span to one of
// the route class's miss hosts (api.spotify.com; streaming-links also counts
// musicbrainz.org and api.music.apple.com). After the deploy, deferred KV and
// D1 writes still appear in the same trace, so compare TTFB first: wall_time_ms
// includes waitUntil work. A span still open when the invocation ends is
// force-closed with warning span_not_ended (no query text, 0 ms); before the
// deploy these are the cut-off fire-and-forget D1 writes, reported as
// "abandoned" and kept out of duration percentiles.

import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ACCOUNT_ID = 'db8ef1f4b492e4727e7fab0e12907871';
const SERVICE = 'listentomore-web';
const D1_DATABASE = 'listentomore';
const HOUR = 3600000;
const DAY = 24 * HOUR;
const EVENT_PAGE_LIMIT = 2000;
const MIN_WINDOW_MS = 60000;
const CONCURRENCY = 4;
const execFileAsync = promisify(execFile);
const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Route classes for metric 1, matched in order against the root span's url.path.
const SPOTIFY_HOSTS = ['api.spotify.com'];
const STREAMING_HOSTS = ['api.spotify.com', 'musicbrainz.org', 'api.music.apple.com'];
const ROUTE_CLASSES = [
  { name: '/album/*', match: (p) => p.startsWith('/album/') && !p.startsWith('/album/search'), missHosts: SPOTIFY_HOSTS },
  { name: '/artist/*', match: (p) => p.startsWith('/artist/') && !p.startsWith('/artist/search'), missHosts: SPOTIFY_HOSTS },
  { name: '/api/internal/search', match: (p) => p === '/api/internal/search', missHosts: SPOTIFY_HOSTS },
  { name: '/api/internal/search-album-by-artist', match: (p) => p === '/api/internal/search-album-by-artist', missHosts: SPOTIFY_HOSTS },
  { name: '/api/internal/streaming-links', match: (p) => p === '/api/internal/streaming-links', missHosts: STREAMING_HOSTS },
  { name: '/api/internal/artist-lastfm', match: (p) => p === '/api/internal/artist-lastfm', missHosts: SPOTIFY_HOSTS },
  { name: '/api/internal/album-summary', match: (p) => p === '/api/internal/album-summary', missHosts: SPOTIFY_HOSTS },
  { name: '/api/internal/user-*', match: (p) => p.startsWith('/api/internal/user-'), missHosts: SPOTIFY_HOSTS },
  { name: '/about', match: (p) => p === '/about', missHosts: SPOTIFY_HOSTS },
];

// Page routes for metric 3: server-rendered HTML, not API, widget, auth, or static files.
const isPageRoute = (p) => !p.startsWith('/api/') && !p.startsWith('/widget/') && !p.startsWith('/auth/')
  && !/\.(css|js|png|jpe?g|svg|ico|webp|gif|woff2?|txt|xml|webmanifest|json|map)$/.test(p);

// KV key buckets for metric 4, first match wins.
const KV_BUCKETS = [
  ['spotify:ratelimit', (k) => k.startsWith('spotify:ratelimit')],
  ['spotify:', (k) => k.startsWith('spotify:')],
  ['streaming-links:', (k) => k.startsWith('streaming-links:')],
  ['other', () => true],
];

// ---------- Query definitions ----------

const filter = (key, operation, value) => ({ key, operation, value, type: 'string' });
const SERVICE_FILTER = filter('$metadata.service', 'eq', SERVICE);
const INVOCATION_FILTERS = [SERVICE_FILTER, filter('$metadata.type', 'eq', 'cf-worker-event')];

function eventsBody(dataset, filters, from, to) {
  return {
    queryId: 'perf-metrics',
    view: 'events',
    limit: EVENT_PAGE_LIMIT,
    timeframe: { from, to },
    parameters: { datasets: [dataset], filters, calculations: [], groupBys: [], havings: [] },
  };
}

function countBody(dataset, filters, groupBys, from, to) {
  return {
    queryId: 'perf-metrics',
    view: 'calculations',
    limit: 500,
    timeframe: { from, to },
    parameters: {
      datasets: [dataset],
      limit: 500,
      filters,
      calculations: [{ operator: 'count', alias: 'n' }],
      groupBys: groupBys.map((value) => ({ type: 'string', value })),
      havings: [],
      ignoreSeries: true,
    },
  };
}

// Raw event pulls. Each is fetched in 6h base windows and split until unsampled.
const EVENT_QUERIES = {
  // Every span for the service over 24h: root spans, KV, D1, fetch. Metrics 1, 3, 4.
  spans24h: { window: '24h', dataset: 'otel', filters: [SERVICE_FILTER] },
  // Streaming-links root spans over 7d (url.path only matches the root span). Metric 2.
  streamingRoots7d: {
    window: '7d',
    dataset: 'otel',
    filters: [SERVICE_FILTER, filter('url.path', 'eq', '/api/internal/streaming-links')],
  },
  // Upstream fetch spans over 7d, one query per host because `in` fails on server.address. Metric 2.
  fetchSpotify7d: {
    window: '7d',
    dataset: 'otel',
    filters: [SERVICE_FILTER, filter('$metadata.spanName', 'eq', 'fetch'), filter('server.address', 'eq', 'api.spotify.com')],
  },
  fetchMusicbrainz7d: {
    window: '7d',
    dataset: 'otel',
    filters: [SERVICE_FILTER, filter('$metadata.spanName', 'eq', 'fetch'), filter('server.address', 'eq', 'musicbrainz.org')],
  },
  fetchApple7d: {
    window: '7d',
    dataset: 'otel',
    filters: [SERVICE_FILTER, filter('$metadata.spanName', 'eq', 'fetch'), filter('server.address', 'eq', 'api.music.apple.com')],
  },
};

// Count queries. '7d' runs per UTC day (clipped to the window) so daily series line up with D1.
const COUNT_QUERIES = {
  outcomeAll7d: {
    window: '7d',
    dataset: 'cloudflare-workers',
    filters: [...INVOCATION_FILTERS, filter('$workers.eventType', 'eq', 'fetch')],
    groupBys: ['$workers.outcome'],
  },
  outcomeStreaming7d: {
    window: '7d',
    dataset: 'cloudflare-workers',
    filters: [...INVOCATION_FILTERS, filter('$workers.event.path', 'eq', '/api/internal/streaming-links')],
    groupBys: ['$workers.outcome'],
  },
  apiInvocations7d: {
    window: '7d',
    dataset: 'cloudflare-workers',
    filters: [...INVOCATION_FILTERS, filter('$workers.event.path', 'starts_with', '/api/')],
    groupBys: [],
  },
  apiInternalInvocations7d: {
    window: '7d',
    dataset: 'cloudflare-workers',
    filters: [...INVOCATION_FILTERS, filter('$workers.event.path', 'starts_with', '/api/internal/')],
    groupBys: [],
  },
  logMusicbrainz503_7d: {
    window: '7d',
    dataset: 'cloudflare-workers',
    filters: [SERVICE_FILTER, filter('$metadata.message', 'includes', '[MusicBrainz] 503')],
    groupBys: [],
  },
  logReleaseLookupFailed7d: {
    window: '7d',
    dataset: 'cloudflare-workers',
    filters: [SERVICE_FILTER, filter('$metadata.message', 'includes', 'Release lookup failed')],
    groupBys: [],
  },
  logMusicbrainzRateWait7d: {
    window: '7d',
    dataset: 'cloudflare-workers',
    filters: [SERVICE_FILTER, filter('$metadata.message', 'includes', '[MusicBrainz] Rate limit: waiting')],
    groupBys: [],
  },
  issues7d: {
    window: '7d',
    dataset: 'real-time-issues',
    filters: [SERVICE_FILTER],
    groupBys: ['$metadata.fingerprint'],
  },
  logKvPutFailed24h: {
    window: '24h',
    dataset: 'cloudflare-workers',
    filters: [SERVICE_FILTER, filter('$metadata.message', 'includes', 'KV PUT failed')],
    groupBys: [],
  },
  logDeferredFailed24h: {
    window: '24h',
    dataset: 'cloudflare-workers',
    filters: [SERVICE_FILTER, filter('$metadata.message', 'includes', 'Deferred'), filter('$metadata.message', 'includes', 'failed')],
    groupBys: [],
  },
};

// D1 side of metric 6. Bounds are filled in from the 7d window (created_at is UTC 'YYYY-MM-DD HH:MM:SS').
const D1_API_USAGE_SQL = (fromSql, toSql) => 'SELECT date(created_at) AS d, COUNT(*) AS n, '
  + "SUM(CASE WHEN endpoint LIKE '/api/internal/%' THEN 1 ELSE 0 END) AS internal "
  + `FROM api_usage_log WHERE created_at >= '${fromSql}' AND created_at < '${toSql}' GROUP BY d ORDER BY d`;

// ---------- CLI plumbing ----------

function parseArgs(argv) {
  const args = { to: 'now', from: null, label: 'adhoc', out: null, skipD1: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--to') args.to = argv[++i];
    else if (a === '--from') args.from = Number(argv[++i]);
    else if (a === '--label') args.label = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--skip-d1') args.skipD1 = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  args.to = args.to === 'now' ? Date.now() : Number(args.to);
  if (!Number.isFinite(args.to)) throw new Error('--to must be epoch milliseconds or now');
  if (args.from !== null && !(Number.isFinite(args.from) && args.from < args.to)) {
    throw new Error('--from must be epoch milliseconds earlier than --to');
  }
  return args;
}

const CF_CWD = mkdtempSync(join(tmpdir(), 'perf-metrics-'));
const log = (...m) => console.error(...m);

async function runCf(args) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { stdout } = await execFileAsync('cf', args, {
        cwd: CF_CWD,
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
        maxBuffer: 512 * 1024 * 1024,
      });
      return JSON.parse(stdout);
    } catch (error) {
      const err = `${error.stderr || ''}${error.message || ''}`;
      // Auth failures are not retried or routed around: stop and surface them.
      if (/\b(401|403)\b|unauthori|authenticat|not logged in|cf auth login/i.test(err)) {
        throw new Error(`cf auth failure, run cf auth login:\n${err.slice(-2000)}`);
      }
      if (/Status code: 400/.test(err) || attempt === 3) throw new Error(`cf ${args.slice(0, 3).join(' ')} failed:\n${err.slice(-3000)}`);
      log(`  retry ${attempt}: ${err.slice(-200).trim()}`);
    }
  }
  throw new Error('unreachable');
}

const runQuery = (body) => runCf(['o11y', 'telemetry', 'query', '--body', JSON.stringify(body)]);
const abrLevel = (res) => res.statistics?.abr_level ?? res.run?.statistics?.abr_level ?? null;

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// Runs fetchWindow over [from,to) and halves any window that reports sampling or a full page.
async function splitUntilExact(windows, fetchWindow) {
  const done = [];
  let pending = windows;
  let splits = 0;
  while (pending.length) {
    const results = await mapLimit(pending, CONCURRENCY, async ([a, b]) => ({ a, b, ...(await fetchWindow(a, b)) }));
    pending = [];
    for (const r of results) {
      const inexact = r.abr !== 1 || r.full;
      if (inexact && r.b - r.a > MIN_WINDOW_MS) {
        const m = Math.floor((r.a + r.b) / 2);
        pending.push([r.a, m], [m, r.b]);
        splits++;
      } else {
        if (inexact) log(`  WARN window ${r.a}-${r.b} abr=${r.abr} full=${r.full} kept`);
        done.push(r);
      }
    }
  }
  done.sort((x, y) => x.a - y.a);
  return { done, splits };
}

function chunk(from, to, size) {
  const out = [];
  for (let t = from; t < to; t += size) out.push([t, Math.min(t + size, to)]);
  return out;
}

function utcDayBuckets(from, to) {
  const out = [];
  let t = from;
  while (t < to) {
    const next = Math.min(Math.floor(t / DAY) * DAY + DAY, to);
    out.push([t, next]);
    t = next;
  }
  return out;
}

async function pullEvents(name, def, win) {
  const { done, splits } = await splitUntilExact(chunk(win.from, win.to, 6 * HOUR), async (a, b) => {
    const res = await runQuery(eventsBody(def.dataset, def.filters, a, b));
    const events = res.events?.events ?? [];
    return { events, abr: abrLevel(res), full: events.length >= EVENT_PAGE_LIMIT };
  });
  const seen = new Set();
  const events = [];
  for (const w of done) {
    for (const e of w.events) {
      const id = `${e.$metadata?.id}|${e.$metadata?.spanId ?? ''}|${e.timestamp}`;
      if (!seen.has(id)) { seen.add(id); events.push(e); }
    }
  }
  const windows = done.map((w) => ({ from: w.a, to: w.b, n: w.events.length, abr: w.abr }));
  log(`  ${name}: ${events.length} events, ${windows.length} windows, ${splits} splits`);
  return { events, meta: { name, ...def, window: win, baseChunkMs: 6 * HOUR, splits, windows } };
}

async function countByDay(name, def, win) {
  const base = def.window === '7d' ? utcDayBuckets(win.from, win.to) : chunk(win.from, win.to, 6 * HOUR);
  const { done, splits } = await splitUntilExact(base, async (a, b) => {
    const res = await runQuery(countBody(def.dataset, def.filters, def.groupBys, a, b));
    const groups = {};
    for (const agg of res.calculations?.[0]?.aggregates ?? []) {
      const key = (agg.groups ?? []).map((g) => g.value).join(' | ') || 'all';
      groups[key] = (groups[key] ?? 0) + agg.value;
    }
    return { groups, abr: abrLevel(res), full: false };
  });
  const total = {};
  const byDay = {};
  for (const w of done) {
    const day = new Date(w.a).toISOString().slice(0, 10);
    byDay[day] ??= {};
    for (const [k, v] of Object.entries(w.groups)) {
      total[k] = (total[k] ?? 0) + v;
      byDay[day][k] = (byDay[day][k] ?? 0) + v;
    }
  }
  log(`  ${name}: ${JSON.stringify(total).slice(0, 120)} (${done.length} windows, ${splits} splits)`);
  return {
    total,
    byDay,
    meta: { name, ...def, window: win, splits, windows: done.map((w) => ({ from: w.a, to: w.b, abr: w.abr })) },
  };
}

// ---------- Stats helpers ----------

function pct(xs, p) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = (v.length - 1) * p;
  const f = Math.floor(k);
  const c = Math.min(f + 1, v.length - 1);
  return Math.round((v[f] + (v[c] - v[f]) * (k - f)) * 10) / 10;
}

const share = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

function latency(rows, field, ps = [0.5, 0.95]) {
  const xs = rows.map((r) => r[field]);
  return Object.fromEntries(ps.map((p) => [`p${Math.round(p * 100)}`, pct(xs, p)]));
}

function countBy(xs, key) {
  const out = {};
  for (const x of xs) {
    const k = key(x) ?? 'null';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// ---------- Trace reconstruction ----------

const src = (e) => e.source ?? {};
const isFetchRoot = (s) => s.cloudflare?.handler_type === 'fetch' && !s.parentSpanId;

function buildTraces(events) {
  const byTrace = new Map();
  for (const e of events) {
    if (e.$metadata?.type !== 'span') continue;
    const s = src(e);
    const tid = s.traceId ?? e.$metadata.traceId;
    if (!byTrace.has(tid)) byTrace.set(tid, []);
    byTrace.get(tid).push(s);
  }
  const traces = [];
  for (const [traceId, spans] of byTrace) {
    const root = spans.find(isFetchRoot);
    if (!root) continue;
    const ttfb = root.cloudflare?.response?.time_to_first_byte_ms ?? null;
    const firstByteAt = ttfb === null ? null : root.startTime + ttfb;
    const kids = spans.filter((s) => s !== root);
    const beforeFirstByte = (s) => firstByteAt === null || s.startTime < firstByteAt;
    // A span still open when the invocation ended is force-closed with this warning: unawaited work that was cut off.
    const abandoned = (s) => s.cloudflare?.warning?.type === 'span_not_ended';
    const d1 = kids.filter((s) => (s.name ?? '').startsWith('d1_'));
    const kv = kids.filter((s) => s.name === 'kv_get' || s.name === 'kv_put');
    const fetches = kids.filter((s) => s.name === 'fetch');
    traces.push({
      traceId,
      path: root.url?.path ?? '',
      method: root.http?.request?.method ?? root.name,
      version: root.cloudflare?.script_version?.id ?? root.faas?.version ?? null,
      outcome: root.cloudflare?.outcome ?? null,
      status: root.http?.response?.status_code ?? null,
      bot: root.cloudflare?.verified_bot_category || null,
      wall: root.wall_time_ms ?? null,
      cpu: root.cpu_time_ms ?? null,
      ttfb,
      duration: root.durationMS ?? null,
      hosts: [...new Set(fetches.map((s) => s.server?.address).filter(Boolean))],
      d1: d1.map((s) => ({
        dur: s.durationMS,
        sqlMs: s.cloudflare?.d1?.response?.sql_duration_ms ?? null,
        query: (s.db?.query?.text ?? '').replace(/\s+/g, ' ').slice(0, 80),
        beforeFirstByte: beforeFirstByte(s),
        abandoned: abandoned(s),
      })),
      kv: kv.map((s) => ({
        op: s.name,
        key: s.cloudflare?.kv?.query?.keys ?? '',
        dur: s.durationMS,
        beforeFirstByte: beforeFirstByte(s),
        abandoned: abandoned(s),
      })),
    });
  }
  return traces;
}

// ---------- Metrics ----------

function metricRoutes(traces) {
  const out = [];
  for (const rc of ROUTE_CLASSES) {
    const rows = traces.filter((t) => rc.match(t.path));
    const isMiss = (t) => t.hosts.some((h) => rc.missHosts.includes(h));
    const miss = rows.filter(isMiss);
    const hit = rows.filter((t) => !isMiss(t));
    const block = (rs) => ({ n: rs.length, wall: latency(rs, 'wall'), ttfb: latency(rs, 'ttfb') });
    out.push({
      route: rc.name,
      missHosts: rc.missHosts,
      all: block(rows),
      miss: block(miss),
      hit: block(hit),
      missRatePct: share(miss.length, rows.length),
      outcomes: countBy(rows, (t) => t.outcome),
    });
  }
  return out;
}

function metricSession(traces) {
  const isSessionSelect = (q) => /FROM sessions WHERE token_hash/i.test(q);
  const summarize = (rows) => {
    const withD1 = rows.filter((t) => t.d1.length);
    const withSession = rows.filter((t) => t.d1.some((d) => isSessionSelect(d.query)));
    const withD1BeforeFirstByte = rows.filter((t) => t.d1.some((d) => d.beforeFirstByte));
    const spans = withD1.flatMap((t) => t.d1);
    // Abandoned spans have no query text and a 0 ms duration, so they are kept out of the duration stats.
    const completed = spans.filter((d) => !d.abandoned);
    const withAbandoned = rows.filter((t) => t.d1.some((d) => d.abandoned));
    return {
      invocations: rows.length,
      withAnyD1: withD1.length,
      withAnyD1Pct: share(withD1.length, rows.length),
      withSessionSelect: withSession.length,
      withSessionSelectPct: share(withSession.length, rows.length),
      withD1BeforeFirstBytePct: share(withD1BeforeFirstByte.length, rows.length),
      d1SpansPerD1Invocation: { p50: pct(withD1.map((t) => t.d1.length), 0.5), mean: withD1.length ? Math.round((spans.length / withD1.length) * 100) / 100 : null },
      d1SpanDurationMs: { p50: pct(completed.map((d) => d.dur), 0.5), p95: pct(completed.map((d) => d.dur), 0.95) },
      d1SqlDurationMs: { p50: pct(completed.map((d) => d.sqlMs), 0.5) },
      abandonedD1Spans: spans.length - completed.length,
      withAbandonedD1Pct: share(withAbandoned.length, rows.length),
      queries: countBy(spans, (d) => (d.abandoned ? '(abandoned: span_not_ended)' : d.query || '(no query text)')),
    };
  };
  return {
    internal: summarize(traces.filter((t) => t.path.startsWith('/api/internal/'))),
    pages: summarize(traces.filter((t) => isPageRoute(t.path))),
  };
}

function metricKv(traces, counts) {
  const spans = traces.flatMap((t) => t.kv);
  const bucketOf = (k) => KV_BUCKETS.find(([, m]) => m(k))[0];
  const groups = [];
  for (const op of ['kv_put', 'kv_get']) {
    for (const [bucket] of KV_BUCKETS) {
      const rows = spans.filter((s) => s.op === op && bucketOf(s.key) === bucket);
      const completed = rows.filter((s) => !s.abandoned);
      groups.push({
        op,
        bucket,
        n: rows.length,
        abandoned: rows.length - completed.length,
        p50: pct(completed.map((s) => s.dur), 0.5),
        p95: pct(completed.map((s) => s.dur), 0.95),
        beforeFirstBytePct: share(rows.filter((s) => s.beforeFirstByte).length, rows.length),
      });
    }
  }
  return {
    scope: 'KV spans inside fetch-handler traces (cron and RPC traces excluded)',
    groups,
    logKvPutFailed24h: counts.logKvPutFailed24h.total.all ?? 0,
    logDeferredFailed24h: counts.logDeferredFailed24h.total.all ?? 0,
  };
}

function metricStreaming(pulls, issuesTop) {
  const roots = pulls.streamingRoots7d.events.map(src).filter(isFetchRoot);
  const hostsByTrace = new Map();
  const fetchRows = { 'api.spotify.com': pulls.fetchSpotify7d, 'musicbrainz.org': pulls.fetchMusicbrainz7d, 'api.music.apple.com': pulls.fetchApple7d };
  for (const [host, pull] of Object.entries(fetchRows)) {
    for (const e of pull.events) {
      const s = src(e);
      if (!hostsByTrace.has(s.traceId)) hostsByTrace.set(s.traceId, new Set());
      hostsByTrace.get(s.traceId).add(host);
    }
  }
  const rows = roots.map((r) => ({
    traceId: r.traceId,
    wall: r.wall_time_ms,
    ttfb: r.cloudflare?.response?.time_to_first_byte_ms ?? null,
    outcome: r.cloudflare?.outcome ?? null,
    hosts: [...(hostsByTrace.get(r.traceId) ?? [])],
  }));
  const miss = rows.filter((r) => r.hosts.length);
  const hit = rows.filter((r) => !r.hosts.length);
  const ps = [0.5, 0.9, 0.95, 0.99];
  const streamingTraceIds = new Set(rows.map((r) => r.traceId));
  const mbSpans = pulls.fetchMusicbrainz7d.events.map(src);
  const mbInStreaming = mbSpans.filter((s) => streamingTraceIds.has(s.traceId));
  const mbIssue = issuesTop.find((i) => /MusicBrainz\] 503/.test(i.title ?? ''));
  return {
    invocations: rows.length,
    misses: {
      n: miss.length,
      missRatePct: share(miss.length, rows.length),
      wall: latency(miss, 'wall', ps),
      ttfb: latency(miss, 'ttfb', ps),
      outcomes: countBy(miss, (r) => r.outcome),
      byHost: countBy(miss.flatMap((r) => r.hosts), (h) => h),
    },
    hits: { n: hit.length, wall: latency(hit, 'wall', ps), ttfb: latency(hit, 'ttfb', ps) },
    musicbrainz: {
      fetchSpansAllRoutes: mbSpans.length,
      fetchSpansInStreamingTraces: mbInStreaming.length,
      spanDurationMs: { p50: pct(mbSpans.map((s) => s.durationMS), 0.5), p95: pct(mbSpans.map((s) => s.durationMS), 0.95) },
      status503Spans: mbSpans.filter((s) => s.http?.response?.status_code === 503).length,
      statusCodes: countBy(mbSpans, (s) => s.http?.response?.status_code),
      streamingInvocationsWithMbSpan: rows.filter((r) => r.hosts.includes('musicbrainz.org')).length,
      streamingInvocationsTotal: rows.length,
      logMusicbrainz503: pulls.counts.logMusicbrainz503_7d.total.all ?? 0,
      logReleaseLookupFailed: pulls.counts.logReleaseLookupFailed7d.total.all ?? 0,
      logRateLimitWaits: pulls.counts.logMusicbrainzRateWait7d.total.all ?? 0,
      issueOccurrences7d: mbIssue ? mbIssue.occurrences7d : 0,
    },
  };
}

function metricOutcomes(counts) {
  const shape = (c) => {
    const total = Object.values(c.total).reduce((a, b) => a + b, 0);
    return { total, byOutcome: c.total, canceledPct: share(c.total.canceled ?? 0, total), byDay: c.byDay };
  };
  return { all: shape(counts.outcomeAll7d), streamingLinks: shape(counts.outcomeStreaming7d) };
}

function d1Utc(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function metricD1Logging(counts, win, skipD1) {
  const obsApi = counts.apiInvocations7d.byDay;
  const obsInternal = counts.apiInternalInvocations7d.byDay;
  let d1Rows = null;
  let d1Error = null;
  const sql = D1_API_USAGE_SQL(d1Utc(win.from), d1Utc(win.to));
  if (!skipD1) {
    const r = spawnSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', D1_DATABASE, '--remote', '--json', '--command', sql], {
      cwd: WEB_DIR,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status === 0) d1Rows = JSON.parse(r.stdout)[0].results;
    else d1Error = (r.stderr || r.stdout || '').slice(-1500);
  }
  const days = Object.keys(obsApi).sort();
  const daily = days.map((d) => {
    const row = d1Rows?.find((x) => x.d === d);
    const obs = obsApi[d]?.all ?? 0;
    return {
      day: d,
      obsApiInvocations: obs,
      obsInternalInvocations: obsInternal[d]?.all ?? 0,
      d1Rows: row ? row.n : d1Rows ? 0 : null,
      d1InternalRows: row ? row.internal : d1Rows ? 0 : null,
      d1CoveragePct: row ? share(row.n, obs) : null,
    };
  });
  const sum = (k) => daily.reduce((a, r) => a + (r[k] ?? 0), 0);
  return {
    sql,
    d1Error,
    daily,
    totals: {
      obsApiInvocations: sum('obsApiInvocations'),
      obsInternalInvocations: sum('obsInternalInvocations'),
      d1Rows: d1Rows ? sum('d1Rows') : null,
      d1InternalRows: d1Rows ? sum('d1InternalRows') : null,
      d1CoveragePct: d1Rows ? share(sum('d1Rows'), sum('obsApiInvocations')) : null,
    },
  };
}

async function issueTitles(win) {
  // Issues that occurred in the window were last observed at or after its start.
  const titles = new Map();
  for (let page = 1; page <= 20; page++) {
    const rows = await runCf(['o11y', 'issues', 'list', '--service', SERVICE, '--per-page', '100', '--page', String(page), '--order-by', 'lastObserved', '--order', 'desc']);
    for (const i of rows) titles.set(i.fingerprint, i);
    if (rows.length < 100 || rows.at(-1).lastObserved < win.from) break;
  }
  return titles;
}

async function metricIssues(counts, win) {
  const titles = await issueTitles(win);
  return Object.entries(counts.issues7d.total)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([fingerprint, occurrences7d]) => {
      const i = titles.get(fingerprint);
      return { fingerprint, occurrences7d, title: i?.title ?? null, type: i?.type ?? null, status: i?.status ?? null, lifetimeCountAtRun: i?.count ?? null };
    });
}

// ---------- Markdown summary ----------

const fmt = (v) => (v === null || v === undefined ? '-' : String(v));
const iso = (ms) => new Date(ms).toISOString();

function markdown(r) {
  const L = [];
  const w1 = r.windowLabels?.['24h'] ?? '24h';
  const w7 = r.windowLabels?.['7d'] ?? '7d';
  L.push(`# perf-metrics ${r.label} (to ${r.to} = ${iso(r.to)})`, '');
  L.push(`Windows: ${w1} ${iso(r.windows['24h'].from)} to ${iso(r.windows['24h'].to)}; ${w7} ${iso(r.windows['7d'].from)} to ${iso(r.windows['7d'].to)}.`);
  L.push(`Root-span script versions (${w1}): ${Object.entries(r.versions24h).map(([k, v]) => `${k.slice(0, 8)} ${v}`).join(', ')}`, '');

  L.push(`## 1. Route latency, ${w1} (ms; miss = trace has a fetch to the miss hosts)`, '');
  L.push('| Route | n | miss % | wall p50 | wall p95 | TTFB p50 | TTFB p95 | miss n | miss wall p50/p95 | miss TTFB p50/p95 | hit n | hit wall p50/p95 | hit TTFB p50/p95 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const x of r.metrics.routes) {
    L.push(`| \`${x.route}\` | ${x.all.n} | ${fmt(x.missRatePct)} | ${fmt(x.all.wall.p50)} | ${fmt(x.all.wall.p95)} | ${fmt(x.all.ttfb.p50)} | ${fmt(x.all.ttfb.p95)} | ${x.miss.n} | ${fmt(x.miss.wall.p50)}/${fmt(x.miss.wall.p95)} | ${fmt(x.miss.ttfb.p50)}/${fmt(x.miss.ttfb.p95)} | ${x.hit.n} | ${fmt(x.hit.wall.p50)}/${fmt(x.hit.wall.p95)} | ${fmt(x.hit.ttfb.p50)}/${fmt(x.hit.ttfb.p95)} |`);
  }

  const s = r.metrics.streamingLinks;
  L.push('', `## 2. Streaming links, ${w7}`, '');
  L.push('| Measure | Value |', '|---|---|');
  L.push(`| Invocations (root spans) | ${s.invocations} |`);
  L.push(`| Misses (any Spotify/MusicBrainz/Apple fetch) | ${s.misses.n} (${fmt(s.misses.missRatePct)}%) |`);
  L.push(`| Miss wall p50/p90/p95/p99 | ${fmt(s.misses.wall.p50)} / ${fmt(s.misses.wall.p90)} / ${fmt(s.misses.wall.p95)} / ${fmt(s.misses.wall.p99)} |`);
  L.push(`| Miss TTFB p50/p90/p95/p99 | ${fmt(s.misses.ttfb.p50)} / ${fmt(s.misses.ttfb.p90)} / ${fmt(s.misses.ttfb.p95)} / ${fmt(s.misses.ttfb.p99)} |`);
  L.push(`| Miss outcomes | ${JSON.stringify(s.misses.outcomes)} |`);
  L.push(`| Hit wall p50/p95 | ${fmt(s.hits.wall.p50)} / ${fmt(s.hits.wall.p95)} (n ${s.hits.n}) |`);
  L.push(`| MusicBrainz fetch spans (all routes / in streaming traces) | ${s.musicbrainz.fetchSpansAllRoutes} / ${s.musicbrainz.fetchSpansInStreamingTraces} |`);
  L.push(`| MusicBrainz span duration p50/p95 | ${fmt(s.musicbrainz.spanDurationMs.p50)} / ${fmt(s.musicbrainz.spanDurationMs.p95)} |`);
  L.push(`| MusicBrainz 503 spans | ${s.musicbrainz.status503Spans} |`);
  L.push(`| Streaming invocations with a MusicBrainz span / total | ${s.musicbrainz.streamingInvocationsWithMbSpan} / ${s.musicbrainz.streamingInvocationsTotal} |`);
  L.push(`| Log rows: \`[MusicBrainz] 503\` / \`Release lookup failed\` / rate-limit waits | ${s.musicbrainz.logMusicbrainz503} / ${s.musicbrainz.logReleaseLookupFailed} / ${s.musicbrainz.logRateLimitWaits} |`);
  L.push(`| Issue occurrences, MusicBrainz 503 | ${s.musicbrainz.issueOccurrences7d} |`);

  L.push('', `## 3. Session cost proxy, ${w1}`, '');
  L.push('| Class | invocations | any D1 % | session SELECT % | D1 before first byte % | abandoned D1 % (spans) | D1 spans per D1 invocation p50 (mean) | D1 span p50/p95 ms |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const [k, v] of Object.entries(r.metrics.session)) {
    L.push(`| ${k} | ${v.invocations} | ${fmt(v.withAnyD1Pct)} | ${fmt(v.withSessionSelectPct)} | ${fmt(v.withD1BeforeFirstBytePct)} | ${fmt(v.withAbandonedD1Pct)} (${v.abandonedD1Spans}) | ${fmt(v.d1SpansPerD1Invocation.p50)} (${fmt(v.d1SpansPerD1Invocation.mean)}) | ${fmt(v.d1SpanDurationMs.p50)}/${fmt(v.d1SpanDurationMs.p95)} |`);
  }

  L.push('', `## 4. KV on fetch invocations, ${w1}`, '');
  L.push('| Op | Key bucket | n | abandoned | p50 ms | p95 ms | started before first byte % |', '|---|---|---|---|---|---|---|');
  for (const g of r.metrics.kv.groups) L.push(`| ${g.op} | \`${g.bucket}\` | ${g.n} | ${g.abandoned} | ${fmt(g.p50)} | ${fmt(g.p95)} | ${fmt(g.beforeFirstBytePct)} |`);
  L.push('', `Log rows ${w1}: \`KV PUT failed\` ${r.metrics.kv.logKvPutFailed24h}; \`Deferred\`+\`failed\` ${r.metrics.kv.logDeferredFailed24h}.`);

  const o = r.metrics.outcomes;
  L.push('', `## 5. Outcomes, ${w7} (fetch invocations)`, '');
  L.push('| Scope | total | by outcome | canceled % |', '|---|---|---|---|');
  L.push(`| all fetch | ${o.all.total} | ${JSON.stringify(o.all.byOutcome)} | ${fmt(o.all.canceledPct)} |`);
  L.push(`| streaming-links | ${o.streamingLinks.total} | ${JSON.stringify(o.streamingLinks.byOutcome)} | ${fmt(o.streamingLinks.canceledPct)} |`);

  const d = r.metrics.d1Logging;
  L.push('', `## 6. api_usage_log vs /api/* invocations, ${w7} (UTC days, clipped to window)`, '');
  L.push('| Day | /api/* invocations | /api/internal/* | D1 rows | D1 internal rows | D1 coverage % |', '|---|---|---|---|---|---|');
  for (const x of d.daily) L.push(`| ${x.day} | ${x.obsApiInvocations} | ${x.obsInternalInvocations} | ${fmt(x.d1Rows)} | ${fmt(x.d1InternalRows)} | ${fmt(x.d1CoveragePct)} |`);
  L.push(`| total | ${d.totals.obsApiInvocations} | ${d.totals.obsInternalInvocations} | ${fmt(d.totals.d1Rows)} | ${fmt(d.totals.d1InternalRows)} | ${fmt(d.totals.d1CoveragePct)} |`);
  if (d.d1Error) L.push('', `D1 query failed: ${d.d1Error.split('\n').slice(-3).join(' ')}`);

  L.push('', `## 7. Top Issues, ${w7}`, '');
  L.push(`| Occurrences ${w7} | Lifetime count at run | Type | Title |`, '|---|---|---|---|');
  for (const i of r.metrics.issues) L.push(`| ${i.occurrences7d} | ${fmt(i.lifetimeCountAtRun)} | ${fmt(i.type)} | ${fmt(i.title ?? i.fingerprint).replace(/\|/g, '\\|')} |`);
  return L.join('\n');
}

// ---------- Main ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const T = args.to;
  // --from collapses both windows to one span; the labels keep the markdown honest about it.
  const windows = args.from === null
    ? { '24h': { from: T - DAY, to: T }, '7d': { from: T - 7 * DAY, to: T } }
    : { '24h': { from: args.from, to: T }, '7d': { from: args.from, to: T } };
  const spanLabel = `${Math.round((T - windows['24h'].from) / HOUR * 10) / 10}h`;
  const windowLabels = args.from === null ? { '24h': '24h', '7d': '7d' } : { '24h': spanLabel, '7d': spanLabel };
  log(`perf-metrics label=${args.label} from=${windows['24h'].from} (${iso(windows['24h'].from)}) to=${T} (${iso(T)})`);

  const pulls = {};
  for (const [name, def] of Object.entries(EVENT_QUERIES)) pulls[name] = await pullEvents(name, def, windows[def.window]);
  const counts = {};
  for (const [name, def] of Object.entries(COUNT_QUERIES)) counts[name] = await countByDay(name, def, windows[def.window]);
  pulls.counts = counts;

  const traces = buildTraces(pulls.spans24h.events);
  const issues = await metricIssues(counts, windows['7d']);
  const result = {
    label: args.label,
    to: T,
    toIso: iso(T),
    generatedAt: iso(Date.now()),
    service: SERVICE,
    windows,
    windowLabels,
    versions24h: countBy(traces, (t) => t.version),
    metrics: {
      routes: metricRoutes(traces),
      streamingLinks: metricStreaming(pulls, issues),
      session: metricSession(traces),
      kv: metricKv(traces, counts),
      outcomes: metricOutcomes(counts),
      d1Logging: metricD1Logging(counts, windows['7d'], args.skipD1),
      issues,
    },
    queries: {
      events: Object.fromEntries(Object.entries(pulls).filter(([k]) => k !== 'counts').map(([k, v]) => [k, v.meta])),
      counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.meta])),
      exampleBodies: {
        events: eventsBody('otel', EVENT_QUERIES.spans24h.filters, windows['24h'].from, windows['24h'].from + 6 * HOUR),
        count: countBody('cloudflare-workers', COUNT_QUERIES.outcomeAll7d.filters, COUNT_QUERIES.outcomeAll7d.groupBys, windows['7d'].from, windows['7d'].to),
      },
    },
    // Compact per-trace rows for the 24h fetch traces, enough to re-slice without re-querying.
    traces24h: traces.map(({ traceId, path, outcome, status, bot, wall, cpu, ttfb, version, hosts, d1, kv }) => ({
      traceId,
      path,
      outcome,
      status,
      bot,
      wall,
      cpu,
      ttfb,
      version: version?.slice(0, 8) ?? null,
      hosts,
      d1: d1.map((x) => [x.query.slice(0, 40), x.dur, x.beforeFirstByte, x.abandoned]),
      kv: kv.map((x) => [x.op, x.key.split(':').slice(0, 2).join(':'), x.dur, x.beforeFirstByte, x.abandoned]),
    })),
  };

  const out = args.out ?? `${args.label}-${T}.json`;
  writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
  log(`wrote ${resolve(out)}`);
  console.log(markdown(result));
}

main()
  .catch((error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('perf-metrics failed:', errorMessage);
    process.exitCode = 1;
  })
  .finally(() => rmSync(CF_CWD, { recursive: true, force: true }));
