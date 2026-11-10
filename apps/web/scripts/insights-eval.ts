// ABOUTME: Live quality gate for the weekly insights note: builds week facts from each fixture, asks the model twice,
// ABOUTME: and checks each note with the production guard and the rubric. Writes JSON and a summary.md to eval-output/.
//
// Usage (from apps/web):
//   pnpm dlx tsx scripts/insights-eval.ts --label <name> [--extra <dir>] [--dry-run]
//
// Fixtures are every WeekInputs JSON in packages/services/insights/__fixtures__ (gold.json is skipped) plus any in
// --extra <dir>. Extra fixtures may belong to other listeners, so their output is labelled extra-1, extra-2, ... in
// file-name order, and the file names appear only on the console, never in eval-output/.
//
// For each fixture: buildWeekFacts, then two calls to getUserInsightsNote, each checked with guardNote and
// checkNoteRubric (the rubric, with the week's names masked). A week the route would not send to the model (under MIN_WEEK_PLAYS plays, or quiet) is recorded as
// skipped. Writes eval-output/<label>/insights/<fixture>.json (prompt view, both raw outputs, guard results, rubric
// hits, tokens, cost, ms) and eval-output/<label>/insights/summary.md, with an opener-overlap figure: the share of
// first-sentence word 4-grams that appear in the notes of two or more different weeks.
//
// Spends real money and never runs in CI. --dry-run makes no API calls: it prints the call count and a cost
// projection from the prompt sizes. Exit code 1 means a fixture failed the guard on both runs or a note tripped
// the rubric; 2 means the run could not start. The prompt views and notes are written only under eval-output/,
// which is gitignored.
//
// ANTHROPIC_API_KEY comes from apps/web/.dev.vars first and falls back to process.env only when the file lacks it.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIService, buildUserInsightsNoteMessages } from '@listentomore/ai';
import type { UserInsightsNoteResult } from '@listentomore/ai';
import { AI_TASKS } from '@listentomore/config';
import { buildWeekFacts, guardNote, renderPromptView } from '@listentomore/insights';
import type { GuardResult, NoteSentence, WeekFacts, WeekInputs } from '@listentomore/insights';
import { MIN_WEEK_PLAYS } from '../src/api/internal/insights-week';
import { evalOutputDir, noteNames } from './insights-eval-lib';
import { checkNoteRubric } from './insights-rubric';
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
  dryRun: boolean;
}

interface Fixture {
  /** File name without .json for committed fixtures; extra-<n> for --extra ones. */
  name: string;
  source: 'fixtures' | 'extra';
  inputs: WeekInputs;
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
  return { label, outDir, extra: extra === undefined ? null : resolve(extra), dryRun: argv.includes('--dry-run') };
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

async function runFixture(fixture: Fixture, keys: { openai: string; anthropic: string }): Promise<FixtureRecord> {
  const wf = buildWeekFacts(fixture.inputs);
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
      console.log(`[insights-eval ${done}/${fixtures.length}] ${record.fixture} | ${status}`);
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
const sum = (values: Array<number | null>): number => values.reduce<number>((s, v) => s + (v ?? 0), 0);

function blockquote(text: string): string {
  if (!text.trim()) return '> _(empty)_';
  return text.trim().split('\n').map((line) => (line.trim() ? `> ${line}` : '>')).join('\n');
}

function guardCell(run: RunRecord | undefined): string {
  if (!run) return '-';
  return run.guard.ok ? 'pass' : `**fail** ${run.guard.failures.join(', ')}`;
}

function renderSummary(label: string, records: FixtureRecord[], runInfo: string, failing: FixtureRecord[]): string {
  const runs = records.flatMap((r) => r.runs);
  const spend = sum(runs.map((r) => r.costUsd));
  const unpriced = runs.filter((r) => r.costUsd === null).length;
  const overlap = openerOverlap(records);
  const lines: string[] = [];

  lines.push(`# Insights eval: ${label}`, '');
  lines.push(
    `${runInfo} ${records.length} fixtures, ${runs.length} model calls, ` +
      `${sum(runs.map((r) => r.inputTokens))} input / ${sum(runs.map((r) => r.outputTokens))} output tokens, ` +
      `${usd(spend)}${unpriced ? ` (${unpriced} calls without a price)` : ''}.`,
    '',
  );
  lines.push(
    failing.length
      ? `**${failing.length} of ${records.length} fixtures failed: ${failing.map((r) => r.fixture).join(', ')}.**`
      : 'No fixture failed the guard on both runs, and no note tripped the rubric.',
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
        `${usd(sum(r.runs.map((x) => x.costUsd)))} | ${sum(r.runs.map((x) => x.ms))} |`,
    );
  }
  lines.push('');

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

/** No API calls: the number of calls and a cost projection that errs high. */
function dryRun(fixtures: Fixture[]): number {
  const model = AI_TASKS.userInsightsSummary.model;
  const price = PRICING[model];
  let calls = 0;
  let inputTokens = 0;
  for (const f of fixtures) {
    const wf = buildWeekFacts(f.inputs);
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
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = loadFixtures(args.extra);
  if (args.dryRun) return dryRun(fixtures);

  const devVars = readDevVars(join(WEB_ROOT, '.dev.vars'));
  const keys = {
    openai: devVars.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '',
    anthropic: devVars.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '',
  };
  if (AI_TASKS.userInsightsSummary.provider === 'anthropic' && !keys.anthropic) {
    throw new Error('ANTHROPIC_API_KEY is not set in apps/web/.dev.vars or process.env');
  }

  console.log(`[insights-eval] ${fixtures.length} fixtures, ${RUNS} runs each, concurrency ${CONCURRENCY}`);
  const started = performance.now();
  const records = await runAll(fixtures, (f) => runFixture(f, keys));
  const wallSeconds = ((performance.now() - started) / 1000).toFixed(0);
  const runInfo = `Run ${new Date().toISOString()} at ${gitRef()}, wall time ${wallSeconds}s.`;

  const { outDir } = args;
  mkdirSync(outDir, { recursive: true });
  for (const r of records) writeFileSync(join(outDir, `${r.fixture}.json`), `${JSON.stringify(r, null, 2)}\n`);
  const failing = records.filter((r) => r.guardFailedBoth || r.rubricHits.length > 0);
  writeFileSync(join(outDir, 'summary.md'), renderSummary(args.label, records, runInfo, failing));

  const spend = sum(records.flatMap((r) => r.runs.map((x) => x.costUsd)));
  console.log(`[insights-eval] Wrote ${outDir}/summary.md (${records.length} fixtures, ${failing.length} failing, ${usd(spend)})`);
  for (const r of failing) {
    const reasons = [
      ...(r.guardFailedBoth ? [`guard failed both runs: ${r.runs.map((x) => x.guard.failures.join(',')).join(' / ')}`] : []),
      ...(r.rubricHits.length ? [`rubric: ${r.rubricHits.join(', ')}`] : []),
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
