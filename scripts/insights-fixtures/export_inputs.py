# ABOUTME: Converts the archived raw Last.fm responses into one WeekInputs JSON fixture for the insights module.
# ABOUTME: Port of the step0 build.py data access (sections 1 to 4); cache-only unless --fetch is passed.
#
# Usage: LFM_RAW=<extracted archive>/prototype/step0/raw \
#   python3 -I export_inputs.py USER TAG WINDOW_END TZ --out DIR [--span FROM TO] [--fetch]
#
# WINDOW_END is local time in TZ ('YYYY-MM-DDTHH:MM' or 'YYYY-MM-DD'), or 'now' for the week that ended when the
# archive was fetched (raw/_now.json). --span is the scrobble span build.py fetched for this user, in epoch seconds;
# build.py fetched one span per user and shared it across that user's weeks, so the exporter must ask for the same
# one to hit the cache. Without --span it uses build.py's default, [T - 35 d, first chart boundary at or after T).
# The file is written to DIR/USER-TAG.json. See README.md for the commands that built the committed fixtures.
#
# By default a lookup missing from the cache stops the export. --fetch lifts that guard for one run: a miss calls the
# Last.fm API with the key in LASTFM_API_KEY and saves the response into LFM_RAW under the same file name, so a later
# cache-only run reproduces the export. The key is never printed.
import argparse, hashlib, json, os, re, sys, time, unicodedata, urllib.error, urllib.parse, urllib.request
from collections import Counter
from datetime import datetime
from zoneinfo import ZoneInfo

DAY = 86400

# ---------- cache access (lfm.py's file names; cache-only unless --fetch) ----------
RAW = os.environ.get('LFM_RAW', '')
if not RAW or not os.path.isdir(RAW):
    sys.exit('LFM_RAW must point at the extracted prototype/step0/raw directory')

class CacheMiss(Exception):
    pass

def fname(params):
    # Same key scheme as lfm.py, so the archived file names resolve unchanged.
    m = params.get('method', 'x')
    rest = '&'.join(f'{k}={params[k]}' for k in sorted(params) if k != 'method')
    h = hashlib.sha1(rest.encode()).hexdigest()[:10]
    safe = ''.join(c if c.isalnum() else '_' for c in rest)[:80]
    return os.path.join(RAW, f'{m}__{safe}__{h}.json')

FETCH = False                   # set from --fetch below
FETCHED = 0                     # network calls this run
API = 'https://ws.audioscrobbler.com/2.0/'
RETRY_ERRORS = (8, 11, 16, 29)  # Last.fm's transient errors, retried as lfm.py did
NOT_FOUND = 6                   # kept in the cache like lfm.py: the readers treat it as no data

def fetch(params):
    """One Last.fm GET for a cache miss. Error messages name the params, never the URL, which holds the key."""
    global FETCHED
    key = os.environ.get('LASTFM_API_KEY', '')
    if not key:
        sys.exit('--fetch needs LASTFM_API_KEY in the environment')
    url = API + '?' + urllib.parse.urlencode(dict(params, api_key=key, format='json'))
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                data = json.load(r)
        except urllib.error.HTTPError as e:
            try:
                data = json.load(e)             # Last.fm sends its error body with a 4xx
            except ValueError:
                if e.code != 429 and e.code < 500:
                    raise RuntimeError(f'HTTP {e.code} for {params}') from None
                data = {'error': 29}            # rate limit or server error without a body: retry
        except (urllib.error.URLError, TimeoutError, ValueError):
            data = {'error': 29}                # network trouble: retry like a rate limit
        FETCHED += 1
        err = data.get('error')
        if err in RETRY_ERRORS:
            time.sleep(2 * (attempt + 1))
            continue
        if err is not None and err != NOT_FOUND:
            raise RuntimeError(f'Last.fm error {err} for {params}')
        return data
    raise RuntimeError(f'Last.fm kept failing for {params}')

def call(params):
    f = fname(params)
    if not os.path.exists(f):
        if not FETCH:
            raise CacheMiss(f'not in the raw cache: {params}')
        data = fetch(params)
        with open(f, 'w') as fh:
            json.dump(data, fh)
        return data
    with open(f) as fh:
        return json.load(fh)

def norm(s): return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', s).lower().replace('‐', '-')).strip()
def aslist(x): return [x] if isinstance(x, dict) else (x if isinstance(x, list) else [])

# ---------- arguments and window ----------
ap = argparse.ArgumentParser(description='Export one WeekInputs fixture from the archived Last.fm cache.')
ap.add_argument('user')
ap.add_argument('tag')
ap.add_argument('window_end')
ap.add_argument('tz')
ap.add_argument('--out', required=True, help='directory to write USER-TAG.json into')
ap.add_argument('--span', nargs=2, type=int, metavar=('FROM', 'TO'), help='cached scrobble span, epoch seconds')
ap.add_argument('--fetch', action='store_true',
                help='on a cache miss, call Last.fm (key in LASTFM_API_KEY) and save the response; default is cache-only')
args = ap.parse_args()
FETCH = args.fetch
U, TZNAME = args.user, args.tz
TZ = ZoneInfo(TZNAME)
with open(os.path.join(RAW, '_now.json')) as fh:
    NOW = json.load(fh)['now']
CURRENT = args.window_end == 'now'
def at_local(s): return int(datetime.strptime(s, '%Y-%m-%dT%H:%M' if 'T' in s else '%Y-%m-%d').replace(tzinfo=TZ).timestamp())
T = NOW if CURRENT else at_local(args.window_end)
F = T - 7 * DAY                 # start of the week itself
S = T - 35 * DAY                # start of the 35 days of scrobbles the module reads

chartlist = [(int(c['from']), int(c['to'])) for c in call({'method': 'user.getweeklychartlist', 'user': U})['weeklychartlist']['chart']]
L = max(t for _, t in chartlist)                                    # end of the latest weekly chart
B = None if CURRENT else min(f for f, _ in chartlist if f >= T)     # first chart boundary at or after T

# ---------- scrobbles ----------
def scrobbles(a, b):
    p1 = call({'method': 'user.getrecenttracks', 'user': U, 'from': a, 'to': b, 'limit': 200, 'extended': 1, 'page': 1})
    pages = int(p1['recenttracks']['@attr']['totalPages'])
    ds = [p1] + [call({'method': 'user.getrecenttracks', 'user': U, 'from': a, 'to': b, 'limit': 200, 'extended': 1, 'page': p}) for p in range(2, pages + 1)]
    out = []
    for d in ds:
        for t in aslist(d['recenttracks'].get('track')):
            if t.get('@attr', {}).get('nowplaying') or 'date' not in t: continue
            out.append({'artist': t['artist']['name'], 'album': t['album']['#text'], 'track': t['name'], 'ts': int(t['date']['uts'])})
    out.sort(key=lambda x: x['ts'])
    return out

span_a, span_b = args.span if args.span else (S, B if B else T)
if span_a > S or span_b < (B if B else T):
    sys.exit(f'span [{span_a}, {span_b}) must cover [{S}, {B if B else T})')
allsc = scrobbles(span_a, span_b)
window = [t for t in allsc if S <= t['ts'] < T]

# ---------- 1. dedupe (build.py's rule; used only to pick the lookups build.py made) ----------
def dedupe(tracks):
    ts_set = Counter(t['ts'] for t in tracks)
    near = lambda ts: any(ts_set.get(ts + d, 0) for d in (-2, -1, 1, 2)) or ts_set[ts] > 1
    kept, last = [], {}
    for t in tracks:
        k = (norm(t['artist']), norm(t['track']))
        p = last.get(k)
        if p is not None and t['ts'] - p['ts'] < 600 and (t['ts'] - p['ts'] < 150 or near(t['ts']) or near(p['ts'])):
            continue
        last[k] = t; kept.append(t)
    return kept
raw0 = [t for t in allsc if F <= t['ts'] < T]
w0 = dedupe(raw0)

# ---------- 2. history as of the week ----------
def artist_chart(f, t):
    d = call({'method': 'user.getweeklyartistchart', 'user': U, 'from': f, 'to': t, 'limit': 1000})
    return {norm(x['name']): int(x['playcount']) for x in aslist((d or {}).get('weeklyartistchart', {}).get('artist'))}
def album_chart(f, t):
    d = call({'method': 'user.getweeklyalbumchart', 'user': U, 'from': f, 'to': t, 'limit': 1000})
    return {(norm(x['artist']['#text']), norm(x['name'])): int(x['playcount']) for x in aslist((d or {}).get('weeklyalbumchart', {}).get('album'))}

# Raw plays from T to the archive's NOW: scrobbles to the next chart boundary, weekly charts, then the tail.
after_artist, after_album = Counter(), Counter()
if not CURRENT:
    for t in allsc:
        if T <= t['ts'] < B: after_artist[norm(t['artist'])] += 1; after_album[(norm(t['artist']), norm(t['album']))] += 1
    for f, t in [(f, t) for f, t in chartlist if f >= B and t <= L]:
        after_artist.update(artist_chart(f, t)); after_album.update(album_chart(f, t))
    for t in scrobbles(L, NOW):
        after_artist[norm(t['artist'])] += 1; after_album[(norm(t['artist']), norm(t['album']))] += 1

def top_artists(period, pages):
    """A cached user.gettopartists list: counts and first ranks keyed by norm(name), and whether every page is cached."""
    counts, ranks, total = {}, {}, 1
    for p in range(1, pages + 1):
        d = call({'method': 'user.gettopartists', 'user': U, 'period': period, 'limit': 1000, 'page': p})
        total = int(d['topartists']['@attr']['totalPages'])
        for i, x in enumerate(aslist(d['topartists'].get('artist'))):
            k = norm(x['name']); counts[k] = max(counts.get(k, 0), int(x['playcount'])); ranks.setdefault(k, (p - 1) * 1000 + i + 1)
    return counts, ranks, total <= pages

def chart_weeks_between(start, edge):
    return [(f, t) for f, t in chartlist if f >= start - 3 * DAY and t <= edge]

# build.py's "before the window" period counts and 6-month rotation; they only drive the tiers that pick tag lookups.
before_window = {}
if CURRENT:
    wk_raw = Counter(norm(t['artist']) for t in raw0)
    for m, per in [(3, '3month'), (6, '6month'), (12, '12month')]:
        pl = top_artists(per, 1 if m == 3 else 2)[0]
        before_window[m] = {a: max(0, n - wk_raw.get(a, 0)) for a, n in pl.items()}
    six = top_artists('6month', 2)[0]
    rot40 = {a for a, _ in sorted(six.items(), key=lambda kv: -kv[1])[:40]}
else:
    pre = Counter(norm(t['artist']) for t in allsc if F - 28 * DAY <= t['ts'] < F)
    for m in (3, 6, 12):
        c = Counter(pre)
        for f, t in chart_weeks_between(F - int(m * 30.44 * DAY), F - 28 * DAY + 12 * 3600): c.update(artist_chart(f, t))
        before_window[m] = c
    rot40 = {a for a, _ in before_window[6].most_common(40)}

ovr, rank_all, ovr_complete = top_artists('overall', 2)

raw_c0 = Counter(t['artist'] for t in raw0)
c0 = Counter(t['artist'] for t in w0)
info_targets = [a for a, n in c0.most_common(25) if n >= 4]
def artist_getinfo(a):
    if a not in info_targets: return None
    d = call({'method': 'artist.getinfo', 'artist': a, 'username': U, 'autocorrect': 0})
    return d['artist'] if d and 'artist' in d else None

CREDIT = re.compile(r'\s(&|and|feat\.?|ft\.?|x|with|\+)\s|,|/', re.I)
tiers = {}
for a in c0:
    ai = artist_getinfo(a)
    upc = int((ai or {}).get('stats', {}).get('userplaycount', -1)) if ai else -1
    life_now = upc if upc >= raw_c0[a] else ovr.get(norm(a))
    before = None if life_now is None or life_now < raw_c0[a] else max(0, life_now - raw_c0[a] - after_artist.get(norm(a), 0))
    absent = next((m for m in (12, 6, 3) if before_window[m].get(norm(a), 0) == 0), None)
    if before is None: tier = 'unknown'
    elif before == 0: tier = 'first_ever' if not CREDIT.search(a) else 'credit_variant'
    elif before <= 15: tier = 'barely_known'
    elif absent and before >= 20: tier = 'lapsed'
    elif rank_all.get(norm(a), 9999) <= 25: tier = 'all_time_favourite'
    else: tier = 'regular' if norm(a) in rot40 or absent is None else 'occasional'
    tiers[a] = tier

# ---------- 4. album runs and their album.getinfo lookups ----------
def runs(w, key, max_gap=90 * 60):
    out, cur = [], []
    for t in w:
        if cur and (key(t) != key(cur[-1]) or t['ts'] - cur[-1]['ts'] > max_gap): out.append(cur); cur = []
        cur.append(t)
    if cur: out.append(cur)
    return out
rr0 = [r for r in runs(w0, lambda t: (norm(t['artist']), norm(t['album']))) if len(r) >= 6 and r[0]['album']]
run_albums = list(dict.fromkeys((r[0]['artist'], r[0]['album']) for r in rr0))
run_artists = [a for a, _ in run_albums]

# ---------- 3. tags (getinfo for the top 25, artist.gettoptags for the artists build.py's round 2 rules needed) ----------
tag_targets = list(dict.fromkeys(
    [a for a, n in c0.most_common(40) if a not in info_targets and n >= 3] +
    [a for a, n in c0.items() if a not in info_targets and n >= 3 and tiers[a] in ('lapsed', 'barely_known', 'first_ever')] +
    [a for a in run_artists if a not in info_targets]))[:45]

# ---------- WeekInputs ----------
def count_list(counts, complete):
    return {'fetchedAt': T, 'complete': complete, 'counts': counts}

def period_as_of_t(m):
    """Plays in the m months before T, as Last.fm's period list would have shown them at T, this week included."""
    cw = chart_weeks_between(T - int(m * 30.44 * DAY), S + 12 * 3600)
    boundary = max(t for _, t in cw)
    if span_a > boundary:
        sys.exit(f'scrobble span starts after the last chart week used for the {m}-month list')
    c = Counter(norm(t['artist']) for t in allsc if boundary <= t['ts'] < T)
    for f, t in cw: c.update(artist_chart(f, t))
    return count_list(dict(c), True)

if CURRENT:
    period = {key: count_list(*top_artists(per, pages)[0::2]) for key, per, pages in
              [('m3', '3month', 1), ('m6', '6month', 2), ('m12', '12month', 2)]}
else:
    period = {'m3': period_as_of_t(3), 'm6': period_as_of_t(6), 'm12': period_as_of_t(12)}

overall_counts = {}
for k, n in ovr.items():
    n_at_t = n - after_artist.get(k, 0)
    if n_at_t >= 0: overall_counts[k] = n_at_t
    else: print(f'overall: dropped one artist whose count at T would be {n_at_t}', file=sys.stderr)

def known_count(x):
    """A Last.fm userplaycount, or None when it is missing or not positive: for a name played this week, 0 is a
    lookup mismatch (getinfo returns 0 for some names containing '+'), not a count. build.py treats it the same way."""
    n = int(x or 0)
    return n if n > 0 else None

artist_lifetime = {}
for a in info_targets:
    ai = artist_getinfo(a)
    upc = known_count(ai.get('stats', {}).get('userplaycount')) if ai else None
    if upc is None: continue
    n_at_t = upc - after_artist.get(norm(a), 0)
    if n_at_t >= raw_c0[a]: artist_lifetime[a] = {'count': n_at_t, 'fetchedAt': T}

def album_key(artist, album): return f'{norm(artist)}\u0000{norm(album)}'
albums = {}
for artist, album in run_albums:
    d = call({'method': 'album.getinfo', 'artist': artist, 'album': album, 'username': U, 'autocorrect': 0})
    al = d.get('album') if d else None
    tracks = [x['name'] for x in aslist(al.get('tracks', {}).get('track') if isinstance(al.get('tracks'), dict) else [])] if al else []
    upc = known_count(al.get('userplaycount')) if al else None
    n_at_t = upc - after_album.get((norm(artist), norm(album)), 0) if upc is not None else None
    albums[album_key(artist, album)] = {'tracklist': tracks or None, 'userPlaycount': n_at_t if n_at_t is not None and n_at_t >= 0 else None,
                                        'fetchedAt': T}

tags = {}
for a in c0:
    ai = artist_getinfo(a)
    if ai and isinstance(ai.get('tags'), dict):
        tags[a] = [x['name'] for x in aslist(ai['tags'].get('tag'))]
    elif a in tag_targets:
        d = call({'method': 'artist.gettoptags', 'artist': a, 'autocorrect': 0})
        tags[a] = [x['name'] for x in aslist((d or {}).get('toptags', {}).get('tag'))]
    elif ai is not None:
        tags[a] = []

chart_weeks = sorted([(f, t) for f, t in chartlist if t <= S], key=lambda x: -x[1])[:8]
out = {
    'username': U,
    'timezone': TZNAME,
    'now': T,
    'scrobbles': window,
    'historyComplete': True,
    'currentWeekTruncated': False,
    'chartWeeks': [{'from': f, 'to': t, 'counts': artist_chart(f, t)} for f, t in sorted(chart_weeks)],
    'period': period,
    'overall': {**count_list(overall_counts, ovr_complete), 'ranks': rank_all},
    'artistLifetime': artist_lifetime,
    'albums': albums,
    'tags': tags,
}
os.makedirs(args.out, exist_ok=True)
path = os.path.join(args.out, f'{U}-{args.tag}.json')
with open(path, 'w') as fh:
    json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
print(f'wrote {path}: {len(window)} scrobbles ({len(raw0)} in the final week), {len(chart_weeks)} chart weeks, '
      f'{len(artist_lifetime)} lifetimes, {len(albums)} albums, {len(tags)} tagged artists'
      + (f', {FETCHED} Last.fm network calls' if FETCH else ''))
