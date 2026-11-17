// ABOUTME: Live eval of the weekly insights note: writes each fixture week's note the way the owner's view does and
// ABOUTME: lays it beside the owner's gold summary, with flags, in eval-output/. The owner reads the notes and decides.
//
// Usage (from apps/web):
//   pnpm dlx tsx scripts/insights-eval.ts --label <name> [--extra <dir>]
//
// Fixtures are every WeekInputs JSON in packages/services/insights/__fixtures__ (gold.json is skipped) plus any in
// --extra <dir>. Extra fixtures may belong to other listeners, so their output is labelled extra-1, extra-2, ... in
// file-name order, and the file names appear only on the console, never in eval-output/.
//
// First, before any key is read or call made, a preflight runs buildWeekFacts and renderPromptView on every fixture; one
// that cannot be built stops the run, named by its label (extra-<n> for --extra ones). Then, for each fixture: a week
// under MIN_WEEK_PLAYS or NOTE_MIN_PLAYS plays is recorded as skipped with the code line the owner would see (none
// under MIN_WEEK_PLAYS, where the route shows its sparse message). Otherwise one writeWeekNote, as the route runs it:
// up to NOTE_ATTEMPTS calls, keeping the first note that passes checkNote, and the code line when none does.
//
// Writes eval-output/<label>/insights/<fixture>.json (the prompt view, every attempt with its raw reply, tokens, cost
// and ms, the final note and its flags) and eval-output/<label>/insights/summary.md. For each fixture, summary.md shows
// its tag, the attempt outcomes, the final note with the owner's gold summary below it when there is one, and the
// flags: check failures, em dashes and negation contrast (names masked), phrases of six or more words copied from the
// voice examples, the word count, marked when it is outside 120-200, and the number of integers the note states. After
// the fixtures, one section lists the opening frames (first four words, names masked) shared by two or more of the
// run's notes, and another the phrases of two to four words found in three or more, each with the fixtures they are
// in. No pass rate gates the run.
//
// Spends real money and never runs in CI. Keys come from apps/web/.dev.vars only, never process.env. Exit code 0 means
// the run finished; 2 means it could not start: an unsupported option (the removed --dry-run and --trivia included), a
// bad --label or --extra, a fixture that fails the preflight, or a missing key. The options and the preflight come
// before .dev.vars is read, and everything before the first call.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIService, USER_INSIGHTS_VOICE_EXAMPLES } from '@listentomore/ai';
import type { AIResponseMetadata, WeekNote } from '@listentomore/ai';
import { AI_TASKS } from '@listentomore/config';
import { renderLine } from '@listentomore/insights';
import type { NoteCheckFailure, WeekFacts, WeekInputs } from '@listentomore/insights';
import { writeWeekNote } from '../src/api/internal/insights-note';
import type { NoteAttempt } from '../src/api/internal/insights-note';
import { MIN_WEEK_PLAYS, NOTE_MIN_PLAYS } from '../src/api/internal/insights-week';
import {
  copiedPhrases,
  countIntegers,
  evalOutputDir,
  fixtureTag,
  goldKey,
  missingDevVarsError,
  parseEvalArgs,
  preflightFixtures,
  repeatedOpenings,
  repeatedPhrases,
  requiredDevVars,
  wordCount,
} from './insights-eval-lib';
import type { FixtureTag, PreparedFixture } from './insights-eval-lib';
import { checkEvalRubric } from './insights-rubric';
import type { RubricHit } from './insights-rubric';
import { createMemoryKV, readDevVars } from './script-env';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(SCRIPT_DIR, '..');
const FIXTURE_DIR = join(WEB_ROOT, '..', '..', 'packages', 'services', 'insights', '__fixtures__');
const GOLD_FILE = 'gold.json';
const CONCURRENCY = 4;
/** The note's target length in words (spec, "Voice"). */
const WORDS_MIN = 120;
const WORDS_MAX = 200;

/**
 * USD per million tokens, from the pricing table in packages/config/src/ai.ts. A model missing here has no cost
 * figure, and the summary says so rather than guessing.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
};

interface CliArgs {
  label: string;
  /** eval-output/<label>/insights, checked to be inside eval-output/ before anything runs. */
  outDir: string;
  extra: string | null;
}

interface Fixture {
  /** File name without .json for committed fixtures; extra-<n> for --extra ones. */
  name: string;
  /** From the name, at load time, so a name fixtureTag cannot read stops the run before any call. */
  tag: FixtureTag;
  inputs: WeekInputs;
}

/** One model call: writeWeekNote's record of it, plus what the call cost and took. */
type AttemptRecord = NoteAttempt & {
  attempt: number;
  model: string | null;
  truncated: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  ms: number;
};

interface Flags {
  /** Every checkNote failure of the attempts that failed it, once each. */
  checkFailures: NoteCheckFailure[];
  /** The rest read the final note, so they are empty (and words null) when no note passed. */
  rubric: RubricHit[];
  copiedPhrases: string[];
  words: number | null;
  /** The integers the note states, read as checkNote reads them. */
  counts: number | null;
}

interface FixtureRecord {
  fixture: string;
  tag: FixtureTag;
  /** Deduplicated plays this week. */
  plays: number;
  /** Why the owner gets no model call, or null when writeWeekNote ran. */
  skipped: string | null;
  promptView: string;
  attempts: AttemptRecord[];
  /** The note that passed checkNote, or null. */
  note: WeekNote | null;
  /** The code line the owner sees instead of a note, or null when a note passed or the week is under MIN_WEEK_PLAYS. */
  line: string | null;
  flags: Flags;
  inputTokens: number;
  outputTokens: number;
  /** Every attempt's cost, or null when a call's model has no price. A thrown call returns no usage and adds 0. */
  costUsd: number | null;
  ms: number;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** parseEvalArgs, then the checks that touch the disk: the output directory and the --extra directory. */
function parseArgs(argv: string[]): CliArgs {
  const { label, extra } = parseEvalArgs(argv);
  const outDir = evalOutputDir(WEB_ROOT, label);
  if (extra !== null && !existsSync(extra)) throw new Error('--extra directory does not exist');
  return { label, outDir, extra: extra === null ? null : resolve(extra) };
}

const isWeekInputs = (value: unknown): value is WeekInputs => {
  const v = value as Partial<WeekInputs> | null;
  return !!v && typeof v.username === 'string' && typeof v.now === 'number' && Array.isArray(v.scrobbles);
};

function readFixtures(dir: string): Array<{ file: string; inputs: WeekInputs }> {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== GOLD_FILE)
    .sort()
    .map((file) => {
      const inputs: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      if (!isWeekInputs(inputs)) throw new Error(`${file} is not a WeekInputs fixture`);
      return { file, inputs };
    });
}

function loadFixtures(extra: string | null): Fixture[] {
  const committed = readFixtures(FIXTURE_DIR).map(({ file, inputs }) => ({ name: basename(file, '.json'), inputs }));
  const extras = extra
    ? readFixtures(extra).map(({ file, inputs }, i) => {
        const name = `extra-${i + 1}`;
        console.log(`[insights-eval] ${name} = ${file}`);
        return { name, inputs };
      })
    : [];
  return [...committed, ...extras].map((f) => ({ ...f, tag: fixtureTag(f.name) }));
}

/** The owner's gold summaries, keyed by week date. */
function loadGold(): Record<string, string> {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, GOLD_FILE), 'utf8')) as Record<string, string>;
}

/** Why the route would not ask the model for the owner's note, or null when it would. */
function skipReason(wf: WeekFacts): string | null {
  if (wf.plays.deduped < MIN_WEEK_PLAYS) return `under ${MIN_WEEK_PLAYS} plays`;
  if (wf.plays.deduped < NOTE_MIN_PLAYS) return `under ${NOTE_MIN_PLAYS} plays`;
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

/** What one getUserInsightsNote call cost and took; metadata is null when the call threw. */
interface CallRecord {
  metadata: AIResponseMetadata | null;
  ms: number;
}

/**
 * `ai` with every note call timed and its metadata kept, in call order. writeWeekNote keeps the model result of the
 * passing attempt only, and the eval prices every attempt.
 */
function recordingNotes(ai: AIService, calls: CallRecord[]): Pick<AIService, 'getUserInsightsNote'> {
  return {
    getUserInsightsNote: async (promptView) => {
      const started = performance.now();
      const elapsed = (): number => Math.round(performance.now() - started);
      try {
        const result = await ai.getUserInsightsNote(promptView);
        calls.push({ metadata: result.metadata ?? null, ms: elapsed() });
        return result;
      } catch (error) {
        calls.push({ metadata: null, ms: elapsed() });
        throw error;
      }
    },
  };
}

function attemptRecord(attempt: NoteAttempt, call: CallRecord | undefined, index: number): AttemptRecord {
  const metadata = call?.metadata ?? null;
  const model = metadata?.model ?? null;
  const inputTokens = metadata?.usage?.inputTokens ?? null;
  const outputTokens = metadata?.usage?.outputTokens ?? null;
  return {
    ...attempt,
    attempt: index + 1,
    model,
    truncated: metadata?.truncated ?? false,
    inputTokens,
    outputTokens,
    costUsd: costOf(model, inputTokens, outputTokens),
    ms: call?.ms ?? 0,
  };
}

async function runFixture(
  fixture: PreparedFixture<Fixture>,
  keys: { openai: string; anthropic: string },
): Promise<FixtureRecord> {
  const { wf, promptView } = fixture;
  const skipped = skipReason(wf);
  const record: FixtureRecord = {
    fixture: fixture.name,
    tag: fixture.tag,
    plays: wf.plays.deduped,
    skipped,
    promptView,
    attempts: [],
    note: null,
    line: wf.plays.deduped < MIN_WEEK_PLAYS ? null : renderLine(wf, 'second'),
    flags: { checkFailures: [], rubric: [], copiedPhrases: [], words: null, counts: null },
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    ms: 0,
  };
  if (skipped) return record;

  // A fresh KV per fixture: nothing is cached across fixtures, and the note itself is never cached.
  const ai = new AIService({ openaiApiKey: keys.openai, anthropicApiKey: keys.anthropic, cache: createMemoryKV().kv });
  const calls: CallRecord[] = [];
  const run = await writeWeekNote(recordingNotes(ai, calls), wf);
  const attempts = run.attempts.map((a, i) => attemptRecord(a, calls[i], i));
  const note = run.note;
  return {
    ...record,
    attempts,
    note,
    line: note ? null : record.line,
    flags: {
      checkFailures: [...new Set(attempts.flatMap((a) => (a.outcome === 'check-failed' ? a.failures : [])))],
      rubric: note ? checkEvalRubric(note.note, wf.names) : [],
      copiedPhrases: note ? copiedPhrases(note.note, USER_INSIGHTS_VOICE_EXAMPLES) : [],
      words: note ? wordCount(note.note) : null,
      counts: note ? countIntegers(note.note) : null,
    },
    inputTokens: sum(attempts.map((a) => a.inputTokens)),
    outputTokens: sum(attempts.map((a) => a.outputTokens)),
    costUsd: attempts.some((a) => a.costUsd === null && a.outcome !== 'call-failed')
      ? null
      : sum(attempts.map((a) => a.costUsd)),
    ms: sum(attempts.map((a) => a.ms)),
  };
}

/** Runs fixtures with bounded concurrency, keeping input order in the result. */
async function runAll<F>(fixtures: F[], run: (f: F) => Promise<FixtureRecord>): Promise<FixtureRecord[]> {
  const results = new Array<FixtureRecord>(fixtures.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < fixtures.length) {
      const i = next++;
      const record = await run(fixtures[i]);
      results[i] = record;
      done++;
      // Outcomes and failure codes only: an extra fixture's names stay out of the console.
      const status = record.skipped ? `skipped (${record.skipped})` : attemptOutcomes(record.attempts);
      console.log(`[insights-eval ${done}/${fixtures.length}] ${record.fixture} | ${status}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fixtures.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const usd = (n: number): string => `$${n.toFixed(4)}`;
function sum(values: Array<number | null>): number {
  return values.reduce<number>((s, v) => s + (v ?? 0), 0);
}

function blockquote(text: string): string {
  if (!text.trim()) return '> _(empty)_';
  return text.trim().split('\n').map((line) => (line.trim() ? `> ${line}` : '>')).join('\n');
}

function attemptOutcome(a: AttemptRecord): string {
  if (a.outcome === 'call-failed') return `call-failed (${a.kind})`;
  if (a.outcome === 'check-failed') return `check-failed (${a.failures.join(', ')})`;
  return a.truncated ? `${a.outcome} (truncated)` : a.outcome;
}

const attemptOutcomes = (attempts: AttemptRecord[]): string => attempts.map(attemptOutcome).join(', ');

const listOrNone = (items: string[]): string => (items.length ? items.join(', ') : 'none');

function renderFlags(r: FixtureRecord): string[] {
  const { flags } = r;
  const words = flags.words === null
    ? 'no note'
    : `${flags.words}${flags.words < WORDS_MIN || flags.words > WORDS_MAX ? ` (outside ${WORDS_MIN}-${WORDS_MAX})` : ''}`;
  return [
    'Flags:',
    '',
    `- Check failures: ${listOrNone(flags.checkFailures)}`,
    `- Rubric: ${listOrNone(flags.rubric)}`,
    `- Copied from the examples: ${listOrNone(flags.copiedPhrases.map((p) => `"${p}"`))}`,
    `- Words: ${words}`,
    `- Counts: ${flags.counts === null ? 'no note' : flags.counts}`,
    '',
  ];
}

function renderFixture(r: FixtureRecord, gold: Record<string, string>): string[] {
  const lines = [`## ${r.fixture} (${r.tag})`, ''];
  if (r.skipped) {
    lines.push(`${r.plays} plays. Skipped: ${r.skipped}, so no model call.`, '');
  } else {
    lines.push(`${r.plays} plays. Attempts: ${attemptOutcomes(r.attempts)}.`, '');
  }
  if (r.note) {
    lines.push('Note:', '', blockquote(r.note.note), '');
  } else if (r.line !== null) {
    lines.push(r.skipped ? 'The owner sees the code line:' : 'No note passed, so the owner sees the code line:', '');
    lines.push(blockquote(r.line), '');
  } else {
    lines.push('The route shows its sparse message.', '');
  }
  const key = goldKey(r.fixture);
  const summary = key ? gold[key] : undefined;
  if (summary) lines.push('Gold summary:', '', blockquote(summary), '');
  if (!r.skipped) lines.push(...renderFlags(r));
  return lines;
}

/** The opening frames repeated across the run's notes, each with the fixtures that open on it, or "none". */
function renderOpenings(openings: Array<{ frame: string; labels: string[] }>): string[] {
  const lines = ['## Openings repeated across weeks', ''];
  if (openings.length === 0) return [...lines, 'none', ''];
  return [...lines, ...openings.map(({ frame, labels }) => `- "${frame}": ${labels.join(', ')}`), ''];
}

/** The phrases repeated across the run's notes, each with the fixtures it is in, or "none". */
function renderRepeated(repeated: Array<{ phrase: string; labels: string[] }>): string[] {
  const lines = ['## Phrases repeated across weeks', ''];
  if (repeated.length === 0) return [...lines, 'none', ''];
  return [...lines, ...repeated.map(({ phrase, labels }) => `- "${phrase}": ${labels.join(', ')}`), ''];
}

function renderSummary(
  label: string,
  records: FixtureRecord[],
  openings: Array<{ frame: string; labels: string[] }>,
  repeated: Array<{ phrase: string; labels: string[] }>,
  runInfo: string,
  gold: Record<string, string>,
): string {
  const attempts = records.flatMap((r) => r.attempts);
  const unpriced = records.filter((r) => r.costUsd === null).length;
  const notes = records.filter((r) => r.note).length;
  const ran = records.filter((r) => !r.skipped).length;
  const lines = [`# Insights eval: ${label}`, ''];
  lines.push(
    `${runInfo} ${records.length} fixtures, ${ran} sent to the model, ${notes} with a note that passed the check. ` +
      `${attempts.length} note calls, ${sum(records.map((r) => r.inputTokens))} input / ` +
      `${sum(records.map((r) => r.outputTokens))} output tokens, total cost ${usd(sum(records.map((r) => r.costUsd)))}` +
      `${unpriced ? ` (${unpriced} fixtures without a price)` : ''}.`,
    '',
  );
  for (const r of records) lines.push(...renderFixture(r, gold));
  lines.push(...renderOpenings(openings), ...renderRepeated(repeated));
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
 * Returns 0 when the run finishes. Every check that can stop the run (the flags, the fixtures, their names and their
 * preflight, the keys) comes before the first call; a throw exits with code 2 below.
 */
async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  // Every fixture is built before .dev.vars is read, so a bad one costs nothing and loses no finished output.
  const fixtures = preflightFixtures(loadFixtures(args.extra));
  const gold = loadGold();

  // Keys come from apps/web/.dev.vars only, and every one the run needs is checked before any live call.
  const devVars = readDevVars(join(WEB_ROOT, '.dev.vars'));
  const missing = missingDevVarsError(devVars, requiredDevVars([AI_TASKS.userInsightsSummary.provider]));
  if (missing) throw new Error(missing);
  const keys = { openai: devVars.OPENAI_API_KEY ?? '', anthropic: devVars.ANTHROPIC_API_KEY ?? '' };

  console.log(`[insights-eval] ${fixtures.length} fixtures, concurrency ${CONCURRENCY}`);
  const started = performance.now();
  const records = await runAll(fixtures, (f) => runFixture(f, keys));
  const wallSeconds = ((performance.now() - started) / 1000).toFixed(0);
  const runInfo = `Run ${new Date().toISOString()} at ${gitRef()}, wall time ${wallSeconds}s.`;
  // runAll keeps input order, so records[i] is fixtures[i]'s record.
  const noted = records.flatMap((r, i) =>
    r.note ? [{ label: r.fixture, note: r.note.note, names: fixtures[i].wf.names }] : [],
  );
  const openings = repeatedOpenings(noted);
  const repeated = repeatedPhrases(noted);

  const { outDir } = args;
  mkdirSync(outDir, { recursive: true });
  for (const r of records) writeFileSync(join(outDir, `${r.fixture}.json`), `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(join(outDir, 'summary.md'), renderSummary(args.label, records, openings, repeated, runInfo, gold));
  console.log(`[insights-eval] Wrote ${outDir}/summary.md (${records.length} fixtures, ${usd(sum(records.map((r) => r.costUsd)))})`);
  return 0;
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
