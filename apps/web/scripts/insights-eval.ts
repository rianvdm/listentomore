// ABOUTME: Live quality gate for the weekly insights note and, with --trivia, the Did you know card: builds week facts
// ABOUTME: from each fixture, asks the model twice, checks each note and card, and writes JSON and summary.md to eval-output/.
//
// Usage (from apps/web):
//   pnpm dlx tsx scripts/insights-eval.ts --label <name> [--extra <dir>] [--trivia] [--dry-run]
//
// Fixtures are every WeekInputs JSON in packages/services/insights/__fixtures__ (gold.json is skipped) plus any in
// --extra <dir>. Extra fixtures may belong to other listeners, so their output is labelled extra-1, extra-2, ... in
// file-name order, and the file names appear only on the console, never in eval-output/.
//
// For each fixture: buildWeekFacts, then two calls to getUserInsightsNote, each checked with guardNote and
// checkNoteRubric (the rubric, with the week's names masked). A week the route would not send to the model (under
// MIN_WEEK_PLAYS plays, or quiet) is recorded as skipped. Writes eval-output/<label>/insights/<fixture>.json (prompt
// view, both raw outputs, guard results, rubric hits, tokens, cost, ms) and eval-output/<label>/insights/summary.md,
// with an opener-overlap figure: the share of first-sentence word 4-grams that appear in the notes of two or more
// different weeks.
//
// --trivia runs the week the way the owner's view does. Spotify release dates (SPOTIFY_CLIENT_ID and
// SPOTIFY_CLIENT_SECRET from .dev.vars) feed the release_week fact before the notes, which keep the note rubric
// (checkNoteRubric, as shipped). Then the card is generated as the owner with the MusicBrainz cap lifted and every candidate
// checked (exhaustive), so each week's final card shows. Every fixture gets fresh in-memory caches, so nothing comes
// from an earlier run. One local limiter spaces every MusicBrainz request 1.1 s apart, and the fixtures take turns on
// MusicBrainz, since the eval runs them concurrently. summary.md adds the release_week facts, each card (rendered in
// the second person, with its checkCopyRubric hits), the known tie-backs report and the making-of facts to fact-check
// with their source URLs. A card rubric hit fails the fixture.
//
// Spends real money and never runs in CI. --dry-run makes no API calls: it prints the call count and a cost
// projection from the prompt sizes. Exit code 1 means a fixture failed the guard on both runs, a note or card
// tripped the rubric, or a card was cut or errored (an outage leaves the card unknown); 2 means the run could not start. The prompt views, notes and cards are written only under
// eval-output/, which is gitignored.
//
// Keys come from apps/web/.dev.vars only, never process.env: the API key of each provider the run's tasks use, plus
// SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET with --trivia. A missing key stops the run before any live call, with
// exit code 2 and a message naming the key.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIService, buildAlbumTriviaMessages, buildUserInsightsNoteMessages } from '@listentomore/ai';
import type { AIResponseMetadata, UserInsightsNoteResult } from '@listentomore/ai';
import { AI_TASKS } from '@listentomore/config';
import {
  buildWeekFacts,
  checkCopyRubric,
  checkNoteRubric,
  collectReleases,
  guardNote,
  libraryFrom,
  renderPromptView,
  standoutAlbum,
} from '@listentomore/insights';
import type { GuardResult, NoteSentence, WeekFacts, WeekInputs } from '@listentomore/insights';
import { MusicBrainzCredits } from '@listentomore/musicbrainz';
import type { CreditsClient, MusicBrainzRateLimiter } from '@listentomore/musicbrainz';
import { SpotifyService } from '@listentomore/spotify';
import { generateCard, renderCard } from '../src/api/internal/insights-card';
import type { CardOutcome, CutReason, TriviaCard } from '../src/api/internal/insights-card';
import { makingOfFact } from '../src/api/internal/insights-making-of';
import type { MakingOfResult } from '../src/api/internal/insights-making-of';
import { MIN_WEEK_PLAYS, spotifyReleaseLookup } from '../src/api/internal/insights-week';
import {
  cardFailure,
  createLocalLimiter,
  createSerialQueue,
  evalOutputDir,
  factCheckLines,
  knownTieBackReport,
  missingDevVarsError,
  noteNames,
  requiredDevVars,
} from './insights-eval-lib';
import { createMemoryKV, readDevVars } from './script-env';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(SCRIPT_DIR, '..');
const FIXTURE_DIR = join(WEB_ROOT, '..', '..', 'packages', 'services', 'insights', '__fixtures__');
const RUNS = 2;
const CONCURRENCY = 4;

/**
 * USD per million tokens, from the pricing table in packages/config/src/ai.ts. A model missing here has no cost
 * figure, and the summary says so rather than guessing.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
};
/** Claude web search: $10 per 1,000 searches, on top of the result tokens billed as input. */
const WEB_SEARCH_USD = 0.01;
/**
 * --dry-run's input estimate per trivia search: the result tokens one basic web search adds, rounded up from the
 * claude-r7-albumrecs run (14.7k input for one search, 54.5k for four). Each trivia call is projected at its
 * max_uses, so the trivia figure errs high.
 */
const DRY_RUN_SEARCH_INPUT_TOKENS = 15_000;
/** --dry-run's output estimate per trivia call: one or two sentences plus a reasoning hop per search. */
const DRY_RUN_TRIVIA_OUTPUT_TOKENS = 800;
/** --dry-run's trivia calls per week: the making-of fact's first attempt and its one regeneration. */
const DRY_RUN_TRIVIA_CALLS_PER_WEEK = 2;
/** --dry-run's output estimate per call: above the 80 to 540 tokens (thinking included) measured for the note. */
const DRY_RUN_OUTPUT_TOKENS = 600;
/** --dry-run's input estimate: characters per token, on the low side so the projection errs high. */
const DRY_RUN_CHARS_PER_TOKEN = 3;
/** n in the opener-overlap figure's word n-grams. */
const OPENER_NGRAM = 4;

interface CliArgs {
  label: string;
  /** eval-output/<label>/insights, checked to be inside eval-output/ before anything runs. */
  outDir: string;
  extra: string | null;
  trivia: boolean;
  dryRun: boolean;
}

interface Fixture {
  /** File name without .json for committed fixtures; extra-<n> for --extra ones. */
  name: string;
  source: 'fixtures' | 'extra';
  inputs: WeekInputs;
}

interface Keys {
  openai: string;
  anthropic: string;
}

/** What --trivia shares across fixtures: Spotify credentials and the one MusicBrainz limiter and queue. */
interface TriviaContext {
  spotify: { clientId: string; clientSecret: string };
  limiter: MusicBrainzRateLimiter;
  serial: <T>(task: () => Promise<T>) => Promise<T>;
}

interface RunRecord {
  run: number;
  raw: string;
  /** The parsed reply, or null when it did not parse. */
  sentences: NoteSentence[] | null;
  /** Sentences joined with a space, as the page shows them; the raw text when the reply did not parse. */
  note: string;
  guard: GuardResult;
  rubric: string[];
  model: string | null;
  truncated: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  ms: number;
  error?: string;
}

interface ReleaseWeekRecord {
  /** The fact's rank among the week's facts (1 is the lead). */
  rank: number;
  salience: number;
  statement: string;
}

/** One candidate the card checked, with the bands and people of each tie-back it found, best first. */
interface CheckedRecord {
  album: string;
  artist: string;
  plays: number;
  /** Null when the album has no release group or credits on MusicBrainz. */
  tieBacks: Array<{ band: string; people: string[]; direct: boolean; plays: number }> | null;
}

interface CardRecord {
  /** Why the card route would return no card without generating, or null when it generated. */
  skipped: string | null;
  status: CardOutcome['status'] | 'error' | null;
  cutReason: CutReason | null;
  /** The card as the owner sees it, or null. */
  card: TriviaCard | null;
  checked: CheckedRecord[];
  knownTieBacks: ReturnType<typeof knownTieBackReport>;
  musicbrainzCalls: number;
  /** albumTrivia calls the making-of fact made (0 when a tie-back was found first). */
  triviaCalls: number;
  webSearches: number;
  inputTokens: number;
  outputTokens: number;
  /** Tokens plus searches, or null when a call's model has no price. */
  costUsd: number | null;
  rubric: string[];
  ms: number;
  error?: string;
}

interface FixtureRecord {
  fixture: string;
  source: Fixture['source'];
  plays: WeekFacts['plays'];
  quiet: boolean;
  lead: { kind: string; salience: number } | null;
  /** Why no model call was made, or null when both runs ran. */
  skipped: string | null;
  promptView: string;
  runs: RunRecord[];
  /** Every run failed the guard (a thrown call or an unparseable reply counts as a failure). */
  guardFailedBoth: boolean;
  rubricHits: string[];
  /** Only with --trivia: Spotify releases found, and the release_week facts that fired. */
  releases: { found: number; facts: ReleaseWeekRecord[] } | null;
  /** Only with --trivia. */
  card: CardRecord | null;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): CliArgs {
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    return value;
  };
  const label = valueOf('--label');
  if (!label) throw new Error('--label <name> is required');
  const outDir = evalOutputDir(WEB_ROOT, label);
  const extra = valueOf('--extra');
  if (extra !== undefined && !existsSync(extra)) throw new Error('--extra directory does not exist');
  return {
    label,
    outDir,
    extra: extra === undefined ? null : resolve(extra),
    trivia: argv.includes('--trivia'),
    dryRun: argv.includes('--dry-run'),
  };
}

const isWeekInputs = (value: unknown): value is WeekInputs => {
  const v = value as Partial<WeekInputs> | null;
  return !!v && typeof v.username === 'string' && typeof v.now === 'number' && Array.isArray(v.scrobbles);
};

function readFixtures(dir: string): Array<{ file: string; inputs: WeekInputs }> {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'gold.json')
    .sort()
    .map((file) => {
      const inputs: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      if (!isWeekInputs(inputs)) throw new Error(`${file} is not a WeekInputs fixture`);
      return { file, inputs };
    });
}

function loadFixtures(extra: string | null): Fixture[] {
  const committed = readFixtures(FIXTURE_DIR).map(({ file, inputs }) => ({
    name: basename(file, '.json'),
    source: 'fixtures' as const,
    inputs,
  }));
  const extras = extra
    ? readFixtures(extra).map(({ file, inputs }, i) => {
        const name = `extra-${i + 1}`;
        console.log(`[insights-eval] ${name} = ${file}`);
        return { name, source: 'extra' as const, inputs };
      })
    : [];
  return [...committed, ...extras];
}

/** Why the route would not ask the model for this week, or null when it would. */
function skipReason(wf: WeekFacts): string | null {
  if (wf.plays.deduped < MIN_WEEK_PLAYS) return `under ${MIN_WEEK_PLAYS} plays`;
  if (wf.quiet) return 'quiet week';
  return null;
}

/** Why the card route would return no card without generating one, or null when it would generate. */
function cardSkipReason(wf: WeekFacts): string | null {
  if (wf.plays.deduped < MIN_WEEK_PLAYS) return `under ${MIN_WEEK_PLAYS} plays`;
  if (wf.cardAlbums.length === 0) return 'no candidate albums';
  return null;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

function costOf(model: string | null, inputTokens: number | null, outputTokens: number | null): number | null {
  const price = model ? PRICING[model] : undefined;
  if (!price || inputTokens === null || outputTokens === null) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

async function runNote(
  ai: AIService,
  wf: WeekFacts,
  promptView: string,
  names: string[],
  run: number,
): Promise<RunRecord> {
  const started = performance.now();
  let result: UserInsightsNoteResult | null = null;
  let error: string | undefined;
  try {
    result = await ai.getUserInsightsNote(promptView);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const ms = Math.round(performance.now() - started);

  const raw = result?.raw ?? '';
  const sentences = result?.sentences ?? null;
  const note = sentences ? sentences.map((s) => s.text.trim()).join(' ') : raw;
  const guard: GuardResult = error
    ? { ok: false, failures: ['error'] }
    : sentences
      ? guardNote(sentences, wf)
      : { ok: false, failures: ['unparseable'] };
  const usage = result?.metadata?.usage;
  const model = result?.metadata?.model ?? null;
  const inputTokens = usage?.inputTokens ?? null;
  const outputTokens = usage?.outputTokens ?? null;
  return {
    run,
    raw,
    sentences,
    note,
    guard,
    rubric: note ? checkNoteRubric(note, names) : [],
    model,
    truncated: result?.metadata?.truncated ?? false,
    inputTokens,
    outputTokens,
    costUsd: costOf(model, inputTokens, outputTokens),
    ms,
    ...(error !== undefined && { error }),
  };
}

/** The release_week facts that made the ranked list, with their rank and salience. */
function releaseWeekFacts(wf: WeekFacts): ReleaseWeekRecord[] {
  return wf.facts
    .filter((f) => f.kind === 'release_week')
    .map((f) => ({ rank: f.id, salience: f.salience, statement: f.statement }));
}

/** A credits client whose every call waits its turn on the shared queue, so one fixture at a time asks MusicBrainz. */
function serializedCredits(credits: CreditsClient, serial: TriviaContext['serial']): CreditsClient {
  return {
    findRelease: (artist, album) => serial(() => credits.findRelease(artist, album)),
    releaseCredits: (releaseId) => serial(() => credits.releaseCredits(releaseId)),
    artistBands: (artistId) => serial(() => credits.artistBands(artistId)),
    get calls() {
      return credits.calls;
    },
  };
}

/**
 * The week's card as the owner's view makes it, with the MusicBrainz cap lifted and every candidate checked. Fresh
 * in-memory caches, so every MusicBrainz call and trivia call is a real one.
 */
async function runCard(wf: WeekFacts, inputs: WeekInputs, keys: Keys, ctx: TriviaContext): Promise<CardRecord> {
  const empty: CardRecord = {
    skipped: null,
    status: null,
    cutReason: null,
    card: null,
    checked: [],
    knownTieBacks: knownTieBackReport(wf.cardAlbums, []),
    musicbrainzCalls: 0,
    triviaCalls: 0,
    webSearches: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    rubric: [],
    ms: 0,
  };
  const skipped = cardSkipReason(wf);
  if (skipped) return { ...empty, skipped };

  const credits = new MusicBrainzCredits(createMemoryKV().kv, ctx.limiter, { maxCalls: Infinity });
  const triviaKv = createMemoryKV().kv;
  const ai = new AIService({ openaiApiKey: keys.openai, anthropicApiKey: keys.anthropic, cache: createMemoryKV().kv });
  const calls: AIResponseMetadata[] = [];
  const makingOf = async (artist: string, album: string): Promise<MakingOfResult> => {
    const result = await makingOfFact(ai, triviaKv, artist, album);
    calls.push(...result.calls);
    return result;
  };

  const started = performance.now();
  let outcome: CardOutcome | null = null;
  let error: string | undefined;
  try {
    outcome = await generateCard(
      { credits: serializedCredits(credits, ctx.serial), makingOf, albumArt: async () => null },
      wf,
      libraryFrom(inputs.overall),
      { exhaustive: true },
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const ms = Math.round(performance.now() - started);

  const card = outcome?.status === 'card' ? renderCard(outcome.card, { person: 'second' }) : null;
  const tieBack = outcome?.status === 'card' && outcome.card.kind === 'tieback' ? outcome.card.tieBack : null;
  const rubricNames = [
    ...noteNames(wf),
    ...(card ? [card.album, card.artist] : []),
    ...(tieBack ? [tieBack.band, ...tieBack.people.map((p) => p.artist.name)] : []),
  ];
  const costs = calls.map((m) => {
    const tokens = costOf(m.model, m.usage?.inputTokens ?? null, m.usage?.outputTokens ?? null);
    return tokens === null ? null : tokens + (m.features?.webSearchRequests ?? 0) * WEB_SEARCH_USD;
  });
  return {
    skipped: null,
    status: outcome?.status ?? 'error',
    cutReason: outcome?.status === 'cut' ? outcome.reason : null,
    card,
    checked: (outcome?.checked ?? []).map((c) => ({
      album: c.album.album,
      artist: c.album.artist,
      plays: c.album.plays,
      tieBacks: c.tieBacks?.map((t) => ({
        band: t.band,
        people: t.people.map((p) => p.artist.name),
        direct: t.direct,
        plays: t.plays,
      })) ?? null,
    })),
    knownTieBacks: knownTieBackReport(wf.cardAlbums, outcome?.checked ?? []),
    musicbrainzCalls: credits.calls,
    triviaCalls: calls.length,
    webSearches: sum(calls.map((m) => m.features?.webSearchRequests ?? null)),
    inputTokens: sum(calls.map((m) => m.usage?.inputTokens ?? null)),
    outputTokens: sum(calls.map((m) => m.usage?.outputTokens ?? null)),
    costUsd: costs.some((c) => c === null) ? null : sum(costs),
    rubric: card ? checkCopyRubric(card.text, rubricNames) : [],
    ms,
    ...(error !== undefined && { error }),
  };
}

async function runFixture(fixture: Fixture, keys: Keys, trivia: TriviaContext | null): Promise<FixtureRecord> {
  let inputs = fixture.inputs;
  let releasesFound = 0;
  if (trivia) {
    // The owner's view looks up release dates before building the facts, so release_week can fire.
    const spotify = new SpotifyService({ ...trivia.spotify, cache: createMemoryKV().kv });
    const releases = await collectReleases(inputs, spotifyReleaseLookup(spotify));
    releasesFound = Object.keys(releases).length;
    inputs = { ...inputs, releases };
  }
  const wf = buildWeekFacts(inputs);
  const promptView = renderPromptView(wf);
  const skipped = skipReason(wf);
  const runs: RunRecord[] = [];
  if (!skipped) {
    // A fresh KV per fixture: nothing is cached across fixtures, and the note itself is never cached here.
    const ai = new AIService({ openaiApiKey: keys.openai, anthropicApiKey: keys.anthropic, cache: createMemoryKV().kv });
    const names = noteNames(wf);
    for (let run = 1; run <= RUNS; run++) runs.push(await runNote(ai, wf, promptView, names, run));
  }
  return {
    fixture: fixture.name,
    source: fixture.source,
    plays: wf.plays,
    quiet: wf.quiet,
    lead: wf.facts[0] ? { kind: wf.facts[0].kind, salience: wf.facts[0].salience } : null,
    skipped,
    promptView,
    runs,
    guardFailedBoth: runs.length > 0 && runs.every((r) => !r.guard.ok),
    rubricHits: [...new Set(runs.flatMap((r) => r.rubric))],
    releases: trivia ? { found: releasesFound, facts: releaseWeekFacts(wf) } : null,
    card: trivia ? await runCard(wf, inputs, keys, trivia) : null,
  };
}

/** Runs fixtures with bounded concurrency, keeping input order in the result. */
async function runAll(fixtures: Fixture[], run: (f: Fixture) => Promise<FixtureRecord>): Promise<FixtureRecord[]> {
  const results = new Array<FixtureRecord>(fixtures.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < fixtures.length) {
      const i = next++;
      const record = await run(fixtures[i]);
      results[i] = record;
      done++;
      const status = record.skipped
        ? `skipped (${record.skipped})`
        : record.runs.map((r) => (r.guard.ok ? 'pass' : `fail ${r.guard.failures.join(',')}`)).join(' | ');
      // The card's kind only: an extra fixture's album names stay out of the console as well.
      const card = record.card ? ` | card ${record.card.card?.kind ?? record.card.skipped ?? record.card.status}` : '';
      console.log(`[insights-eval ${done}/${fixtures.length}] ${record.fixture} | ${status}${card}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fixtures.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Opener overlap
// ---------------------------------------------------------------------------

function ngrams(text: string, n: number): Set<string> {
  const words = text.toLowerCase().replace(/[‘’]/g, "'").match(/[\p{L}\p{N}']+/gu) ?? [];
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

/**
 * Share of distinct first-sentence word 4-grams, across every parsed note, that occur in the notes of two or more
 * different fixtures. Repeats between the two runs of one week do not count: those are the same facts.
 */
function openerOverlap(records: FixtureRecord[]): { shared: number; total: number; examples: string[] } {
  const weeksByGram = new Map<string, Set<string>>();
  for (const r of records) {
    for (const run of r.runs) {
      const first = run.sentences?.[0]?.text;
      if (!first) continue;
      for (const gram of ngrams(first, OPENER_NGRAM)) {
        const weeks = weeksByGram.get(gram) ?? new Set<string>();
        weeks.add(r.fixture);
        weeksByGram.set(gram, weeks);
      }
    }
  }
  const shared = [...weeksByGram.entries()]
    .filter(([, weeks]) => weeks.size > 1)
    .sort(([a, x], [b, y]) => y.size - x.size || a.localeCompare(b));
  return { shared: shared.length, total: weeksByGram.size, examples: shared.slice(0, 10).map(([g, w]) => `${g} (${w.size})`) };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const cell = (value: unknown): string => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const usd = (n: number): string => `$${n.toFixed(4)}`;
function sum(values: Array<number | null>): number {
  return values.reduce<number>((s, v) => s + (v ?? 0), 0);
}

function blockquote(text: string): string {
  if (!text.trim()) return '> _(empty)_';
  return text.trim().split('\n').map((line) => (line.trim() ? `> ${line}` : '>')).join('\n');
}

function guardCell(run: RunRecord | undefined): string {
  if (!run) return '-';
  return run.guard.ok ? 'pass' : `**fail** ${run.guard.failures.join(', ')}`;
}

const noteSpend = (r: FixtureRecord): number => sum(r.runs.map((x) => x.costUsd));
const cardSpend = (r: FixtureRecord): number => r.card?.costUsd ?? 0;
/** Every fixture's spend: both note runs, plus the card's trivia calls with --trivia. */
const fixtureSpend = (r: FixtureRecord): number => noteSpend(r) + cardSpend(r);

/** A fixture fails on a guard failure in both runs, a note rubric hit, or a card that was cut, errored or tripped the rubric. */
const isFailing = (r: FixtureRecord): boolean =>
  r.guardFailedBoth || r.rubricHits.length > 0 || cardFailure(r.card) !== null;

function renderReleaseWeek(records: FixtureRecord[]): string[] {
  const lines = ['## Release week', ''];
  const fired = records.filter((r) => (r.releases?.facts.length ?? 0) > 0);
  lines.push(
    `${fired.length} of ${records.length} fixtures had a release_week fact. ` +
      `Spotify releases found per fixture: ${records.map((r) => `${r.fixture} ${r.releases?.found ?? 0}`).join(', ')}.`,
    '',
  );
  if (fired.length === 0) return lines;
  lines.push('| Fixture | Rank | Salience | Statement |');
  lines.push('|---|---|---|---|');
  for (const r of fired) {
    for (const f of r.releases?.facts ?? []) {
      lines.push(`| ${cell(r.fixture)} | ${f.rank} | ${f.salience} | ${cell(f.statement)} |`);
    }
  }
  lines.push('');
  return lines;
}

function cardOutcome(c: CardRecord): string {
  if (c.skipped) return `skipped: ${c.skipped}`;
  if (c.error) return `error: ${c.error}`;
  if (c.status === 'cut') return `cut: ${c.cutReason}`;
  return c.card?.kind ?? c.status ?? '-';
}

function renderCards(records: FixtureRecord[]): string[] {
  const withCard = records.filter((r) => r.card);
  const cards = withCard.map((r) => r.card as CardRecord);
  const lines = ['## Card', ''];
  lines.push(
    `${cards.filter((c) => c.card).length} of ${withCard.length} fixtures got a card ` +
      `(${cards.filter((c) => c.card?.kind === 'tieback').length} tie-back, ` +
      `${cards.filter((c) => c.card?.kind === 'making_of').length} making-of). ` +
      `${sum(cards.map((c) => c.musicbrainzCalls))} MusicBrainz calls, ${sum(cards.map((c) => c.triviaCalls))} trivia ` +
      `calls with ${sum(cards.map((c) => c.webSearches))} web searches, ${usd(sum(cards.map((c) => c.costUsd)))}.`,
    '',
  );
  lines.push('| Fixture | Kind | Album | Text | Source | MusicBrainz calls | Rubric hits | Cost | ms |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of withCard) {
    const c = r.card as CardRecord;
    const album = c.card ? `${c.card.album} (${c.card.artist})` : '-';
    lines.push(
      `| ${cell(r.fixture)} | ${cell(cardOutcome(c))} | ${cell(album)} | ${cell(c.card?.text ?? '-')} | ` +
        `${cell(c.card?.sourceUrl ?? '-')} | ${c.musicbrainzCalls} | ${c.rubric.length ? cell(c.rubric.join(', ')) : '-'} | ` +
        `${c.costUsd === null ? 'unpriced' : usd(c.costUsd)} | ${c.ms} |`,
    );
  }
  lines.push('');
  lines.push('Candidates checked, in order, with their tie-backs (band: people, library plays):', '');
  for (const r of withCard) {
    const c = r.card as CardRecord;
    if (c.checked.length === 0) {
      lines.push(`- ${r.fixture}: none checked`);
      continue;
    }
    const albums = c.checked.map((a) => {
      const ties = a.tieBacks === null
        ? 'not on MusicBrainz'
        : a.tieBacks.length === 0
          ? 'no tie-back'
          : a.tieBacks.map((t) => `${t.band}${t.direct ? ' (direct)' : ''}: ${t.people.join(' and ')}, ${t.plays}`).join('; ');
      return `${a.album} (${a.artist}, ${a.plays} plays): ${ties}`;
    });
    lines.push(`- ${r.fixture}: ${albums.join(' / ')}`);
  }
  lines.push('');
  return lines;
}

function renderKnownTieBacks(records: FixtureRecord[]): string[] {
  const lines = ['## Known tie-backs', ''];
  const rows = records.flatMap((r) =>
    (r.card?.knownTieBacks ?? []).filter((k) => k.status !== 'not a candidate').map((k) => ({ fixture: r.fixture, ...k })),
  );
  const candidateAlbums = new Set(rows.map((k) => k.album));
  const never = [...new Set((records[0]?.card?.knownTieBacks ?? []).map((k) => k.album))].filter((a) => !candidateAlbums.has(a));
  if (rows.length > 0) {
    lines.push('| Fixture | Album | Band | Status |');
    lines.push('|---|---|---|---|');
    for (const k of rows) lines.push(`| ${cell(k.fixture)} | ${cell(k.album)} | ${cell(k.band)} | ${k.status} |`);
    lines.push('');
  }
  lines.push(never.length ? `Not a candidate in any week: ${never.join(', ')}.` : 'Every known album was a candidate in some week.', '');
  return lines;
}

function renderFactCheck(records: FixtureRecord[]): string[] {
  const lines = factCheckLines(records.map((r) => ({ fixture: r.fixture, card: r.card?.card ?? null })));
  return ['## Fact check', '', ...(lines.length ? lines : ['No making-of card in this run.']), ''];
}

function renderSummary(label: string, records: FixtureRecord[], runInfo: string, failing: FixtureRecord[]): string {
  const runs = records.flatMap((r) => r.runs);
  const trivia = records.some((r) => r.card);
  const triviaCalls = sum(records.map((r) => r.card?.triviaCalls ?? null));
  const spend = sum(records.map(fixtureSpend));
  const unpriced = runs.filter((r) => r.costUsd === null).length + records.filter((r) => r.card?.costUsd === null).length;
  const overlap = openerOverlap(records);
  const lines: string[] = [];

  lines.push(`# Insights eval: ${label}`, '');
  lines.push(
    `${runInfo} ${records.length} fixtures, ${runs.length} note calls${trivia ? ` and ${triviaCalls} trivia calls` : ''}, ` +
      `${sum(runs.map((r) => r.inputTokens))} input / ${sum(runs.map((r) => r.outputTokens))} note tokens, ` +
      `${usd(spend)}${trivia ? ` (notes ${usd(sum(records.map(noteSpend)))}, trivia ${usd(sum(records.map(cardSpend)))})` : ''}` +
      `${unpriced ? ` (${unpriced} without a price)` : ''}.`,
    '',
  );
  lines.push(
    failing.length
      ? `**${failing.length} of ${records.length} fixtures failed: ${failing.map((r) => r.fixture).join(', ')}.**`
      : `No fixture failed the guard on both runs, and no note${trivia ? ' or card' : ''} tripped the rubric` +
        `${trivia ? '; no card was cut or errored' : ''}.`,
    '',
  );

  lines.push('| Fixture | Plays | Lead fact | Run 1 guard | Run 2 guard | Rubric hits | Tokens in / out | Cost | ms |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of records) {
    const lead = r.lead ? `${r.lead.kind} ${r.lead.salience}` : '-';
    const guards = r.skipped ? [`skipped: ${r.skipped}`, '-'] : [guardCell(r.runs[0]), guardCell(r.runs[1])];
    lines.push(
      `| ${cell(r.fixture)} | ${r.plays.deduped} | ${cell(lead)} | ${cell(guards[0])} | ${cell(guards[1])} | ` +
        `${r.rubricHits.length ? cell(r.rubricHits.join(', ')) : '-'} | ` +
        `${sum(r.runs.map((x) => x.inputTokens))} / ${sum(r.runs.map((x) => x.outputTokens))} | ` +
        `${usd(fixtureSpend(r))} | ${sum(r.runs.map((x) => x.ms))} |`,
    );
  }
  lines.push('');
  if (trivia) {
    lines.push(...renderReleaseWeek(records), ...renderCards(records), ...renderKnownTieBacks(records), ...renderFactCheck(records));
  }

  const share = overlap.total ? ((overlap.shared / overlap.total) * 100).toFixed(1) : '0.0';
  lines.push('## Opener overlap', '');
  lines.push(
    `${overlap.shared} of ${overlap.total} distinct first-sentence ${OPENER_NGRAM}-grams (${share}%) appear in the notes ` +
      'of two or more different weeks.' +
      (overlap.examples.length ? ` Most shared (weeks): ${overlap.examples.map((e) => `"${e}"`).join(', ')}.` : ''),
    '',
  );

  for (const r of records) {
    lines.push(`## ${r.fixture}`, '');
    if (r.skipped) {
      lines.push(`Skipped: ${r.skipped}.`, '');
      continue;
    }
    for (const run of r.runs) {
      const extras = [
        run.truncated ? 'truncated' : null,
        run.rubric.length ? `rubric: ${run.rubric.join(', ')}` : null,
        run.error ? `error: ${run.error}` : null,
      ].filter(Boolean);
      lines.push(`Run ${run.run} (guard ${run.guard.ok ? 'pass' : `fail: ${run.guard.failures.join(', ')}`}` +
        `${extras.length ? `; ${extras.join('; ')}` : ''}):`, '');
      lines.push(blockquote(run.note), '');
    }
  }
  return lines.join('\n');
}

function gitRef(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: WEB_ROOT }).toString().trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: WEB_ROOT }).toString().trim();
    return `${branch}@${sha}`;
  } catch {
    return 'unknown git ref';
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * No API calls: the number of calls and a cost projection that errs high. With --trivia, every week that would
 * generate a card and has a standout album is projected at two albumTrivia calls, each at its search cap. MusicBrainz
 * and Spotify calls cost nothing.
 */
function dryRun(fixtures: Fixture[], trivia: boolean): number {
  const model = AI_TASKS.userInsightsSummary.model;
  const price = PRICING[model];
  let calls = 0;
  let inputTokens = 0;
  const triviaTask = AI_TASKS.albumTrivia;
  const triviaPrice = PRICING[triviaTask.model];
  const searchesPerCall = triviaTask.webSearchMaxUses;
  let triviaCalls = 0;
  let triviaCost = 0;
  for (const f of fixtures) {
    const wf = buildWeekFacts(f.inputs);
    const standout = trivia && !cardSkipReason(wf) ? standoutAlbum(wf) : null;
    if (standout && triviaPrice) {
      const promptTokens = Math.ceil(
        buildAlbumTriviaMessages(standout.artist, standout.album).reduce((s, m) => s + m.content.length, 0) / DRY_RUN_CHARS_PER_TOKEN,
      );
      triviaCalls += DRY_RUN_TRIVIA_CALLS_PER_WEEK;
      triviaCost += DRY_RUN_TRIVIA_CALLS_PER_WEEK * (((promptTokens + searchesPerCall * DRY_RUN_SEARCH_INPUT_TOKENS) * triviaPrice.input
        + DRY_RUN_TRIVIA_OUTPUT_TOKENS * triviaPrice.output) / 1_000_000 + searchesPerCall * WEB_SEARCH_USD);
    }
    if (skipReason(wf)) continue;
    const chars = buildUserInsightsNoteMessages(renderPromptView(wf)).reduce((s, m) => s + m.content.length, 0);
    calls += RUNS;
    inputTokens += RUNS * Math.ceil(chars / DRY_RUN_CHARS_PER_TOKEN);
  }
  const outputTokens = calls * DRY_RUN_OUTPUT_TOKENS;
  const cost = price ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000 : null;
  console.log(
    `[insights-eval] dry run: ${fixtures.length} fixtures, ${calls} calls to ${model}, about ${inputTokens} input / ` +
      `${outputTokens} output tokens, projected ${cost === null ? 'unknown (no price for this model)' : usd(cost)}`,
  );
  if (trivia) {
    console.log(
      `[insights-eval] dry run trivia: ${triviaCalls} calls to ${triviaTask.model} at ${searchesPerCall} searches each, ` +
        `projected ${triviaPrice ? usd(triviaCost) : 'unknown (no price for this model)'}; ` +
        `total ${cost === null || !triviaPrice ? 'unknown' : usd(cost + triviaCost)}`,
    );
  }
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = loadFixtures(args.extra);
  if (args.dryRun) return dryRun(fixtures, args.trivia);

  // Keys come from apps/web/.dev.vars only, and every one the run needs is checked before any live call.
  const devVars = readDevVars(join(WEB_ROOT, '.dev.vars'));
  const providers = [AI_TASKS.userInsightsSummary.provider, ...(args.trivia ? [AI_TASKS.albumTrivia.provider] : [])];
  const missing = missingDevVarsError(devVars, requiredDevVars(providers, args.trivia));
  if (missing) throw new Error(missing);
  const keys: Keys = { openai: devVars.OPENAI_API_KEY ?? '', anthropic: devVars.ANTHROPIC_API_KEY ?? '' };
  // One limiter and one queue for every fixture, so concurrent fixtures share the 1.1 s spacing.
  const trivia: TriviaContext | null = args.trivia
    ? {
        spotify: { clientId: devVars.SPOTIFY_CLIENT_ID, clientSecret: devVars.SPOTIFY_CLIENT_SECRET },
        limiter: createLocalLimiter(),
        serial: createSerialQueue(),
      }
    : null;

  console.log(`[insights-eval] ${fixtures.length} fixtures, ${RUNS} runs each, concurrency ${CONCURRENCY}${trivia ? ', with the card' : ''}`);
  const started = performance.now();
  const records = await runAll(fixtures, (f) => runFixture(f, keys, trivia));
  const wallSeconds = ((performance.now() - started) / 1000).toFixed(0);
  const runInfo = `Run ${new Date().toISOString()} at ${gitRef()}, wall time ${wallSeconds}s.`;

  const { outDir } = args;
  mkdirSync(outDir, { recursive: true });
  for (const r of records) writeFileSync(join(outDir, `${r.fixture}.json`), `${JSON.stringify(r, null, 2)}\n`);
  const failing = records.filter(isFailing);
  writeFileSync(join(outDir, 'summary.md'), renderSummary(args.label, records, runInfo, failing));

  const spend = sum(records.map(fixtureSpend));
  const split = trivia ? ` (notes ${usd(sum(records.map(noteSpend)))}, trivia ${usd(sum(records.map(cardSpend)))})` : '';
  console.log(`[insights-eval] Wrote ${outDir}/summary.md (${records.length} fixtures, ${failing.length} failing, ${usd(spend)}${split})`);
  for (const r of failing) {
    const reasons = [
      ...(r.guardFailedBoth ? [`guard failed both runs: ${r.runs.map((x) => x.guard.failures.join(',')).join(' / ')}`] : []),
      ...(r.rubricHits.length ? [`rubric: ${r.rubricHits.join(', ')}`] : []),
      ...[cardFailure(r.card)].filter((reason): reason is string => reason !== null),
    ];
    console.log(`[insights-eval]   ${r.fixture} | ${reasons.join('; ')}`);
  }
  return failing.length ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error('[insights-eval] Run failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  },
);
