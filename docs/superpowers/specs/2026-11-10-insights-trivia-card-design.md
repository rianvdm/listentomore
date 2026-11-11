# Design: "Did you know" card, release-week fact and note variant C

**Date:** 2026-11-10
**Status:** Draft for owner approval
**Branch:** `insights-trivia-card` (from `main` at `fa3ba2e`)
**Builds on:** the shipped week-facts design (`docs/superpowers/specs/2026-11-08-insights-week-facts-design.md`) and the local branch `insights-prompt-experiment` (variant C and the trivia spike).

## Why

The weekly note shipped on 2026-11-10. It is accurate, but it reads like a stats readout, and the owner expected something longer that brings out connections. Two prompt experiments on fixture weeks showed what a prompt alone can do. Variant C makes the note longer and leads with a call about the week. The calls stay thin, though, because the facts themselves are thin. A web-search trivia spike produced the most interesting moment of the round. If its date is right, Inferno came out on Fri May 29, the same day the owner played Boards of Canada 41 times.

The owner wants three things:

1. A "Did you know" card about a record he spent time with this week. Best of all is a fact that ties back to music he already listens to: "this album has Chad Smith of Red Hot Chili Peppers on drums".
2. A note that makes calls about the week (variant C).
3. A fact the note can use when he played an album in the week it came out.

What would make him wince is obvious AI slop. Every sentence a user sees must pass `~/git/product-ai/01-context/avoid-ai-patterns.md`.

## Goals

1. Ship note prompt variant C, with the guard and question fixes listed under "Note changes".
2. Add a `release_week` fact to the week facts.
3. Add a "Did you know" card under the note, visible to owner and visitors, that shows either a credits tie-back or a making-of fact.

## Non-goals

- A Claude-written tie-back. Tie-backs are rendered by code from credit data.
- Trivia about artists rather than albums.
- More than one card per week.
- Background jobs, queues or cron precompute (same constraint as phase 1).
- Phase 2 chart notes from the earlier design.

## Anti-goals (failure even if it works)

- Text that reads as AI-generated. Overused words, negation-contrast, em dashes, announcing ("Here's the fact:"), stakes inflation, and the other families in `avoid-ai-patterns.md` are failures, not style notes.
- A fact the app cannot back up: a wrong date, a wrong player, or a band membership overstated (a touring stint described as "a member of").
- A card every week whatever the quality. Show no card before a weak one.
- Slowing the note. The card loads on its own after the note.

## Decided by the owner (2026-11-10)

- The card is its own block under the note, with the album art (option B in the mockup), not a section inside the note.
- When the week's standout album has no tie-back but another album he played start to finish does, the card features the tie-back album.
- A tie-back appears in roughly a third of weeks. The rest of the time the card falls back to a making-of fact. That ratio is acceptable.
- Visitors see the card too.
- A tie-back counts only for a band or person with 10 or more lifetime plays, and the card states the count.
- Variant C ships with this work.
- The release-week fact goes into the note's facts.

## Design

### 1. The card

**Candidate albums.** Two sources: every album named in the top six facts, and every album run this week of 6 or more distinct tracks, whatever its verdict. Order them by plays this week. Cap: 6 candidates.

**Tie-back data (MusicBrainz).**

- For each candidate, resolve the release group by artist and album. Strip remaster and edition suffixes before searching. Pick the earliest official release.
- Fetch the release's artist credits and relations, including recording-level relations.
- Also fetch the members of the album's own artist. That covers cases like "Thom Yorke and Jonny Greenwood are also The Smile".
- For each credited person and each member, fetch their `member of band` relations. Use only `member of band`, never `supporting musician` or other relations. Ignore any relation flagged as touring.
- Keep only people with performer or producer roles: instrument, vocals, performer, producer. Drop engineering, mastering, mixing and design credits.
- A tie-back is a person or band with **10 or more lifetime plays** in the user's library (owner decision), using the overall top-artist list already collected for week facts.
- Excluded as too obvious: the album's own artist, and that artist's own other bands. Eddie Vedder → Pearl Jam is out.
- When an album has several tie-backs, the order is:
  - guests and session players before members of the album's band (Chad Smith on Earthling beats Thom Yorke → The Smile);
  - then the matched band's lifetime plays, highest first.
- All MusicBrainz calls go through the existing `MUSICBRAINZ_RATE_LIMITER` Durable Object.
- Per-album and per-artist results are cached globally, not per user. A missing result is cached too, with a shorter life, so the app doesn't re-ask.
- Cap: 10 MusicBrainz calls per card request. The limiter spaces calls about 1.1 s apart and gives up on waits over 5 s, so 10 calls is roughly the most a page should wait.
  - Amended 2026-11-11 (owner): raised to 30. In production, 10 calls took about 25 s and left a week of fresh albums needing several reloads. The card loads on its own after the note, so a longer lookup only delays the card.
- What is fetched is cached, so later loads continue where the cap stopped.
- If the cap is reached before every candidate has been checked and no tie-back has turned up, the request returns no card and caches no card result. It does not fall back to the making-of fact. The next load continues.
- The making-of fallback runs only once every candidate has been checked.

**Tie-back text.** Rendered by code from templates, never by a model. It names:

- the album;
- the person and their role on it;
- the band from the user's library, with the lifetime play count stated plainly (owner decision).

It uses "has played in" for band links, which is true for past and present members, and never claims rank ("most played"). Examples:

- "Earthling has Chad Smith and Josh Klinghoffer on it. Both have played in Red Hot Chili Peppers, a band you've played 19 times."
- "Los Ojos Del Cóndor was produced by Dan Auerbach of The Black Keys, a band you've played 531 times."

At most two people per card. The owner sees "you"; visitors see the username. The templates are checked against `avoid-ai-patterns.md` in tests.

**Making-of fallback.** When no candidate has a tie-back, the card uses the `albumTrivia` web-search task from the spike for the standout album (`standoutAlbum` from the spike). Requirements:

- Keep the spike's prompt and the basic `web_search_20250305` tool.
- The answer must carry at least one web-search citation, or it is discarded. The card stores the cited source URL and shows it as a small "Source" link.
- The text passes an extended rubric: the existing taste words, plus em dashes, negation-contrast patterns, an announcing preamble ("Here's", "Fun fact"), and the overused-word lists in `avoid-ai-patterns.md`. On failure, regenerate once, then show no card.
- NONE, a missing citation, or a second failure means no card. The negative result is cached for 30 days.
- A good result is cached for 120 days per album, globally.

**Album art and layout.** The card shows the album's cover from the app's existing Spotify album lookup, a "Did you know" label with album and artist, the text, and the source link when there is one. Styles use existing CSS variables.

**Endpoint.** A new internal route, e.g. `/api/internal/user-insights-trivia`.

- It runs the same visibility check before any cache read.
- It reuses the cached week facts, with no new Last.fm calls, and returns nothing if the facts aren't cached yet.
- It returns `{ data: { kind: 'tieback' | 'making_of', album, artist, text, sourceUrl?, imageUrl? } | null }`.
- The page fetches it after the note renders.
- The card's result is cached per profile against the facts signature. The "you"/username wording is rendered per viewer from that one cached result.
- Only the owner's own view can start generation: MusicBrainz lookups, Spotify lookups and the web-search call. A visitor's request reads the cached card and gets no card if none exists. That matches the existing rule that only the owner triggers model calls.

### 2. Release-week fact

- A new fact kind, `release_week`. It fires when an album with a `start_to_finish` or `most_of` run this week was released in the week window, or on the day of the run.
- Release date comes from the Spotify album data the app already fetches and caches. It is looked up during collection for at most 6 albums with a run this week, ordered by plays this week.
- Only day-precision dates count; month-only and year-only dates never fire.
- Reissues never fire, because Spotify dates the edition, not the original. The fact is skipped when:
  - the Last.fm or Spotify title carries an edition marker (remaster, remastered, deluxe, anniversary, edition, expanded, reissue, alternative master);
  - or the normalised Spotify title doesn't match the Last.fm album title.
- Statement: "{Album} by {Artist} came out on {day}, and you played it start to finish that day". The wording varies for most_of and for the same week. All values are typed like every other fact.
- Initial salience is 70, plus 10 when played on the release day itself. It is judged in the eval. Any change to these numbers needs an eval run (the existing rule).
- Spotify release dates are the label's date and can differ from MusicBrainz. Use Spotify only, for one source of truth. This is my call.

### 3. Note changes (variant C)

Port the spike's commits from `insights-prompt-experiment`: prompt C (`0450d45`), the guard idioms (`837623f`) and the trivia task with `standoutAlbum` and the eval flag (`eb04be9`). Skip variant A's prompt (`17ed7c7`), but keep its 6-sentence cap. Then fix what round 2 found:

- The shape rule requires sentence 1 to cite fact 1, which variant C no longer asks for. Change it to: fact 1 must be cited by some sentence.
- Accept "first plays under these names" and "under those names" for a plural set of first-under-this-name artists.
- "a week already full of …" and similar idioms are not quantities.
- A sentence with `facts: []` makes that sentence fail the guard, not the whole note unparseable.
- The question's "after" edge needs 72+ hours without plays before the window end, raised from 36.

The prompt version becomes `v7`. The live eval must pass before merge, with no fixture failing the guard twice and no rubric hits.

## Tests and eval

- Unit tests:
  - MusicBrainz parsing, including releases without credits;
  - role filtering;
  - membership filtering (no supporting or touring links);
  - library matching;
  - tie-back selection order;
  - templates in both persons, checked against the AI-pattern rubric;
  - the release-week fact (including day precision);
  - the guard fixes;
  - the trivia endpoint's visibility check and cache behaviour.
- Eval: extend `insights-eval.ts --trivia` so each fixture week shows the note, the card (tie-back or making-of) and rubric results. The eval runs the card as the owner, with the cap lifted, so each week's final card is visible. Known tie-backs from the recon:
  - Los Ojos Del Cóndor → The Black Keys
  - Earthling → Red Hot Chili Peppers and Tom Petty and the Heartbreakers
  - Sea Change → Nine Inch Nails
  - In Rainbows → The Smile

  The eval reports which of these appear when their album is a candidate. A week with no tie-back is an acceptable result.
- Fact check: the eval output lists each making-of fact with its source URL. The owner spot-checks them before merge.

## Left to the builder

- Template wording, within the rules above.
- How album titles are normalised for MusicBrainz search.
- Cache key names and lifetimes for MusicBrainz data, within the global-cache rule.
- How the card's request and the note's request share the facts cache.
- Card markup and empty-state behaviour, which should be no card and no gap.

## Calls I made without asking

- Tie-backs are code-rendered, not model-written.
- The making-of fact needs a web-search citation and shows a source link.
- Release dates come from Spotify, not MusicBrainz, and reissues are skipped.
- Candidate albums: up to 6, from the top facts plus runs of 6+ tracks, ordered by plays.
- MusicBrainz is capped at 10 calls per card request. A cut-off request shows no card and caches no card result.
- The album artist and its own other bands never count as tie-backs. Guests rank before band members.
- Only the owner's view generates a card; visitors read the cached one.
- `release_week` starts at salience 70 (+10 on release day), pending the eval.
- Engineering, mastering, mixing and design credits are excluded from tie-backs.
