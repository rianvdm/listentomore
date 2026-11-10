# Insights fixtures

`export_inputs.py` turns archived raw Last.fm responses into `WeekInputs` JSON (the input type in `packages/services/insights/src/types.ts`). It is a port of the data-access half of the step0 reference builder, `build.py`, which lives in the private vault at `05-personal/side-projects/listentomore/insights-redesign-research/step0/round2/`. By default it never calls the Last.fm API: a lookup missing from the cache stops it with an error.

`--fetch` lifts that guard for one run. A cache miss then calls Last.fm with the key in `LASTFM_API_KEY` and saves the response into `LFM_RAW` under the archive's file name, so a later run without `--fetch` reproduces the export. Pass it only when exporting a week the archive does not cover, and only against a temporary extract.

The raw responses are in the vault archive `insights-redesign-research/raw-lastfm-cache.tar.gz`. Extract it to a temporary directory outside both repositories; `LFM_RAW` points at the `prototype/step0/raw` directory inside it.

## Committed owner weeks

The three annotated weeks in `packages/services/insights/__fixtures__/` came from these commands (Python 3.9 or later, run from the repository root):

```bash
export LFM_RAW=/path/to/extracted/prototype/step0/raw
OUT=packages/services/insights/__fixtures__
python3 -I scripts/insights-fixtures/export_inputs.py bordesak 2026-05-24 2026-05-31T00:00 America/Los_Angeles --out "$OUT" --span 1777186800 1782043200
python3 -I scripts/insights-fixtures/export_inputs.py bordesak 2026-05-31 2026-06-07T00:00 America/Los_Angeles --out "$OUT" --span 1777186800 1782043200
python3 -I scripts/insights-fixtures/export_inputs.py bordesak 2026-06-12 2026-06-19T15:40 America/Los_Angeles --out "$OUT" --span 1777186800 1782043200
```

`--span` is the one scrobble span `build.py` fetched for the owner and shared across his weeks; the cache only holds that span.

## Held-out owner weeks

The eval (`apps/web/scripts/insights-eval.ts`) also reads two past weeks that no ranking test or tuning round has seen. The archive did not cover them, so they were exported with `--fetch` on 2026-11-09 (the archive's "now" is 2026-11-08 22:12 UTC). `LASTFM_API_KEY` comes from `apps/web/.dev.vars`:

```bash
export LFM_RAW=/path/to/extracted/prototype/step0/raw LASTFM_API_KEY=...
OUT=packages/services/insights/__fixtures__
python3 -I scripts/insights-fixtures/export_inputs.py bordesak heldout-2026-08-02 2026-08-09T00:00 America/Los_Angeles --out "$OUT" --fetch
python3 -I scripts/insights-fixtures/export_inputs.py bordesak heldout-2026-09-20 2026-09-27T00:00 America/Los_Angeles --out "$OUT" --fetch
```

The live fetch reads lifetime and album counts as of the export, a day after the archive's "now", and the exporter subtracts only the plays up to that "now". None of the artists or albums these two weeks look up had plays in between, so the counts match the archive's snapshot.

`bordesak-live-2026-11-09.json` is not an export: `apps/web/scripts/capture-week-inputs.ts` captured it from Last.fm through the production collector. `gold.json` holds the owner's own summaries of the same weeks, copied verbatim from the voice-examples worksheet in the vault (weeks 4, 3 and 1).

## The other listener

The fixture set also includes one week from another listener with a public profile. That week must be written to the vault, `insights-redesign-research/step0/fixtures/`, and never to this repository: no file, test, comment or commit here names that listener or their window. Its username, window end and timezone are in the vault's `insights-redesign-research/step0-round2-report.md`.

## How a past week is reconstructed

For a window ending at `T`:

- `scrobbles`: raw scrobbles in `[T - 35 d, T)`, ascending.
- `chartWeeks`: the 8 weekly artist charts ending at or before `T - 35 d`, counts keyed by normalised artist name.
- `period.m3 / m6 / m12`: what Last.fm's 3, 6 and 12 month lists would have shown at `T`: weekly charts back to the start of the period, then scrobbles from the last of those charts to `T`.
- `overall`: today's overall list minus plays after `T` (scrobbles, then weekly charts, then scrobbles since the last chart); ranks from today's list; `complete` only if every page is cached.
- `artistLifetime`: `artist.getinfo` `userplaycount` minus plays after `T`, for the artists `build.py` looked up; artists with a `userplaycount` of 0 or less, or whose result is below the week's raw plays, are left out.
- `albums`: `album.getinfo` tracklist, and `userplaycount` minus album plays after `T`, for the album runs `build.py` looked up. A `userplaycount` of 0 or less, or a negative result, is `null` (unknown): for an album played this week, 0 is a lookup mismatch, not a count.
- `tags`: raw tag names in Last.fm order, from `artist.getinfo` or `artist.gettoptags`.

Every derived count carries `fetchedAt: T`. A week ending `now` uses the cached period lists as they are.
