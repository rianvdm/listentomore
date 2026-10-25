// ABOUTME: Throwaway quality gate that runs every AI task against fixed inputs via AIService.
// ABOUTME: Writes per-task JSON and a summary.md to eval-output/<label>/ for provider comparison.
//
// Usage (from apps/web):
//   pnpm dlx tsx scripts/ai-eval.ts --label openai-baseline [--concurrency 4]
//   pnpm dlx tsx scripts/ai-eval.ts --label claude-r4 --only artistSummary,albumDetail
//   pnpm dlx tsx scripts/ai-eval.ts --rescore openai-baseline
//
// --label spends real money: every case is a live API call, and nothing is
// served from cache because each run gets a fresh in-memory KV. --rescore makes
// no API calls: it reruns the current checks over a saved run and writes the
// result to eval-output/<label>-rescored/. --only <task,task,...> limits a live
// run to those tasks; the output holds only their JSON files. Exit code 1 means at least one record
// has a violation or was truncated; 2 means the run could not start.
//
// Checks beyond placeholders and formatting: `narration` on every task (the
// model describing its search), and for artistSentence only, `selfCorrection`
// (a visible redraft such as "Correction, final:") and `wordCount` (over
// ARTIST_SENTENCE_MAX_WORDS visible words; the prompt asks for under 38).
// For albumRecommendations only, `sourceNarration` (sources, review sites, or
// streaming availability named in the prose, e.g. "listed as similar").
//
// API keys come from apps/web/.dev.vars first and fall back to process.env only
// when the file lacks a key, so a key exported in the shell for another project
// or org is never billed for this repo's eval.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIService, isCacheableResponse } from '@listentomore/ai';
import type {
  ChatClient,
  CommonChatResponse,
  InsightsListeningData,
} from '@listentomore/ai';
import { AI_TASKS, type AITask } from '@listentomore/config';

type Metadata = NonNullable<CommonChatResponse['metadata']>;

interface EvalInputs {
  artists: string[];
  albums: Array<{ artist: string; album: string; year: number }>;
  genres: string[];
  recommendationSeeds: Array<{ artist: string; album: string }>;
  insights: Array<{ username: string; listeningData: InsightsListeningData }>;
  listenAi: string[];
  randomFact: number;
}

interface EvalRecord {
  task: AITask;
  input: Record<string, unknown>;
  provider: string;
  model: string;
  content: string;
  /** Placeholders the model emitted, counted in the raw (pre-substitution) text */
  placeholders: { artists: number; albums: number };
  /** Search links in the rendered content, Markdown and <a href> forms */
  linksProduced: number;
  violations: string[];
  truncated: boolean;
  webSearchUsed: boolean;
  webSearchRequests: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  ms: number;
  /** API calls behind this record (userInsightsSummary may add a scrub pass) */
  calls: number;
  /** The model's text before any post-processing, so --rescore can rerun every check */
  rawContent?: string;
  /** userInsightsRecommendations only: entries the production parser extracted */
  parsedRecommendations?: number;
}

/** Everything the checks read, built from a live call or from a saved record. */
interface ScoringInput {
  task: AITask;
  label: string;
  content: string;
  /** null for records saved before rawContent was recorded */
  raw: string | null;
  placeholders: { artists: number; albums: number };
  truncated: boolean;
  parsedRecommendations?: number;
}

interface CaseOutput {
  /** What the page renders (post-processed where the prompt function does it) */
  content: string;
  /** userInsightsRecommendations only: entries the production parser extracted */
  parsedRecommendations?: number;
}

interface EvalCase {
  task: AITask;
  input: Record<string, unknown>;
  run: (ai: AIService, rawCalls: CommonChatResponse[]) => Promise<CaseOutput>;
}

const TASK_ORDER: AITask[] = [
  'artistSummary',
  'artistSentence',
  'albumDetail',
  'genreSummary',
  'albumRecommendations',
  'listenAi',
  'userInsightsSummary',
  'userInsightsRecommendations',
  'randomFact',
];

// First-line heading/title checks apply to prose summaries only. albumDetail is
// excluded on purpose: its prompt asks for ### headers on each section, so a
// heading on line one is correct output there.
const TITLE_LINE_TASKS = new Set<AITask>([
  'artistSummary',
  'genreSummary',
  'userInsightsSummary',
]);

// Fewest search links a healthy row produces. A model that writes plain names
// instead of [[Artist]] / {{Album}} placeholders yields zero links and would
// otherwise pass every other check. Baseline: 16-25, 10-16 and 3 per row.
const MIN_LINKS: Partial<Record<AITask, number>> = {
  artistSummary: 1,
  genreSummary: 1,
  albumRecommendations: 3,
};

// These prompt functions substitute {{Album by Artist}} first and strip any
// [[Artist]] nested inside it instead of linking it, so a nested artist
// placeholder legitimately yields no artist link. artistSummary substitutes
// artists first, so its nested artists do become links.
const STRIPS_NESTED_ARTISTS = new Set<AITask>(['genreSummary', 'albumRecommendations']);

/** Sources, review sites, or streaming availability named in visitor-facing prose. */
const SOURCE_NARRATION_PATTERN =
  /\b(listed as similar|Album of the Year|Rate Your Music|AllMusic|Pitchfork|Metacritic|on Spotify|on Apple Music|on Bandcamp|according to|search results?)\b/i;

// The model describing its own search instead of answering. The client drops
// text before the last search result, so this catches what slips past it
// ("Based on the search results, ...") as well as prompts that never searched.
const NARRATION_PATTERNS = [
  /^\s*(I'll|I will|Let me|I'm going to|Based on (the|my) search)/i,
  /\b(my search|search results?|I searched)\b/i,
];

// Sonnet 5.5 at low effort redrafted in the visible output ("Correction,
// final answer: ..."), which the prompt's word cap alone does not catch.
const SELF_CORRECTION_PATTERN = /\b(Correction|final answer|final:|Actually,|Let me (fix|correct|restate))/i;

// Well over the prompt's 38-word cap, so a slightly long sentence still
// passes but a doubled draft does not.
const ARTIST_SENTENCE_MAX_WORDS = 60;

const FALLBACK_PATTERN =
  /^(Not enough information available|There is no information available)/i;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(SCRIPT_DIR, '..');

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

interface CliArgs {
  mode: 'run' | 'rescore';
  label: string;
  concurrency: number;
  /** Tasks to run, in TASK_ORDER; every task when --only is absent. */
  tasks: AITask[];
}

function parseArgs(argv: string[]): CliArgs {
  // A flag given without a value is an error, not "flag absent": a bare
  // --only would otherwise run (and bill) every task.
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} needs a value`);
    }
    return value;
  };

  const runLabel = valueOf('--label');
  const rescoreLabel = valueOf('--rescore');
  const label = runLabel ?? rescoreLabel;
  if (!label || (runLabel && rescoreLabel) || !/^[\w.-]+$/.test(label)) {
    throw new Error(
      'Pass exactly one of --label <name> or --rescore <name> (letters, digits, dot, dash, underscore)'
    );
  }

  const concurrency = Number(valueOf('--concurrency') ?? 4);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('--concurrency must be a positive integer');
  }

  const only = valueOf('--only');
  if (only !== undefined && rescoreLabel) {
    throw new Error('--only applies to --label runs; --rescore rescores whatever the saved run holds');
  }
  const tasks = only === undefined ? TASK_ORDER : parseTaskList(only);

  return { mode: rescoreLabel ? 'rescore' : 'run', label, concurrency, tasks };
}

/** Comma-separated task names, validated and returned in TASK_ORDER. */
function parseTaskList(value: string): AITask[] {
  const names = value.split(',').map((n) => n.trim()).filter(Boolean);
  const unknown = names.filter((n) => !TASK_ORDER.includes(n as AITask));
  if (!names.length || unknown.length) {
    throw new Error(
      `--only takes a comma-separated list of tasks from: ${TASK_ORDER.join(', ')}` +
        (unknown.length ? ` (unknown: ${unknown.join(', ')})` : '')
    );
  }
  return TASK_ORDER.filter((t) => names.includes(t));
}

/** Parse KEY=value lines from a .dev.vars file. Values may be quoted. */
function readDevVars(path: string): Record<string, string> {
  if (!existsSync(path)) return {};

  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = trimmed.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    vars[key] = value;
  }
  return vars;
}

/** Resolve a secret, .dev.vars first (see header). Required only if a task routes to it. */
function resolveKey(name: string, devVars: Record<string, string>, required: boolean): string {
  const value = devVars[name] || process.env[name] || '';
  if (required && !value) {
    throw new Error(`${name} is not set in apps/web/.dev.vars or process.env`);
  }
  return value;
}

/**
 * Map-backed KVNamespace stand-in: enough for AICache and AIRateLimiter.
 * A fresh one per run guarantees every case is a live call.
 */
function createMemoryKV(): KVNamespace {
  const store = new Map<string, string>();
  const stub = {
    async get(key: string, type?: string | { type?: string }) {
      const value = store.get(key);
      if (value === undefined) return null;
      const kind = typeof type === 'string' ? type : type?.type;
      return kind === 'json' ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return {
        keys: [...store.keys()].map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      };
    },
  };
  return stub as unknown as KVNamespace;
}

/**
 * Wrap the service's router so every raw client response is captured before
 * the prompt function post-processes it. Placeholder counts, the bold-pair
 * check, and metadata for tasks whose results drop it all come from here.
 */
function captureRawCalls(ai: AIService): CommonChatResponse[] {
  const calls: CommonChatResponse[] = [];
  const route = ai.getClientForTask.bind(ai);
  ai.getClientForTask = (task: AITask): ChatClient => {
    const client = route(task);
    return {
      async chatCompletion(options) {
        const response = await client.chatCompletion(options);
        calls.push(response);
        return response;
      },
    };
  };
  return calls;
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

function buildCases(inputs: EvalInputs): EvalCase[] {
  const cases: EvalCase[] = [];

  for (const artist of inputs.artists) {
    cases.push({
      task: 'artistSummary',
      input: { artist },
      run: async (ai) => ({ content: (await ai.getArtistSummary(artist)).summary }),
    });
  }

  for (const artist of inputs.artists) {
    cases.push({
      task: 'artistSentence',
      input: { artist },
      run: async (ai) => ({ content: (await ai.getArtistSentence(artist)).sentence }),
    });
  }

  for (const { artist, album, year } of inputs.albums) {
    cases.push({
      task: 'albumDetail',
      input: { artist, album, year },
      run: async (ai) => ({ content: (await ai.getAlbumDetail(artist, album, year)).content }),
    });
  }

  for (const genre of inputs.genres) {
    cases.push({
      task: 'genreSummary',
      input: { genre },
      run: async (ai) => ({ content: (await ai.getGenreSummary(genre)).content }),
    });
  }

  for (const { artist, album } of inputs.recommendationSeeds) {
    cases.push({
      task: 'albumRecommendations',
      input: { artist, album },
      run: async (ai) => ({
        content: (await ai.getAlbumRecommendations(artist, album)).content,
      }),
    });
  }

  for (const question of inputs.listenAi) {
    cases.push({
      task: 'listenAi',
      input: { question },
      run: async (ai) => ({ content: (await ai.askListenAI(question)).response }),
    });
  }

  for (const { username, listeningData } of inputs.insights) {
    cases.push({
      task: 'userInsightsSummary',
      input: { username },
      run: async (ai) => ({
        content: (await ai.getUserInsightsSummary(username, listeningData)).content,
      }),
    });
  }

  for (const { username, listeningData } of inputs.insights) {
    cases.push({
      task: 'userInsightsRecommendations',
      input: { username },
      // The page renders parsed entries, so read the model's raw text and
      // report separately how many entries the production parser recovered.
      run: async (ai, rawCalls) => {
        const result = await ai.getUserInsightsRecommendations(username, listeningData);
        return {
          content: rawCalls[0]?.content ?? '',
          parsedRecommendations: result.recommendations.length,
        };
      },
    });
  }

  for (let i = 1; i <= inputs.randomFact; i++) {
    cases.push({
      task: 'randomFact',
      input: { run: i },
      run: async (ai) => ({ content: (await ai.generateAndStoreRandomFact()).fact }),
    });
  }

  return cases;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function firstMatch(text: string, pattern: RegExp): string {
  return (text.match(pattern)?.[0] ?? '').slice(0, 60);
}

function countPlaceholders(raw: string): { artists: number; albums: number } {
  return {
    artists: countMatches(raw, /\[\[[^\]]+\]\]/g),
    albums: countMatches(raw, /\{\{[^}]+\}\}/g),
  };
}

/** Artist placeholders written inside an album placeholder: {{Album by [[Artist]]}} */
function countNestedArtists(raw: string): number {
  return [...raw.matchAll(/\{\{([^}]+)\}\}/g)].reduce(
    (sum, m) => sum + countMatches(m[1], /\[\[[^\]]+\]\]/g),
    0
  );
}

/**
 * Placeholder integrity, the owner's top concern, in both directions: a model
 * that drops the convention (zero links), a substitution that silently loses a
 * placeholder (count mismatch), and a malformed placeholder that survives
 * substitution as literal brackets on the page.
 */
function placeholderViolations(input: ScoringInput): string[] {
  const { task, content, raw, placeholders } = input;
  const violations: string[] = [];

  if (/\[\[|\{\{/.test(content)) {
    violations.push(`unreplaced placeholder: ${firstMatch(content, /(\[\[|\{\{)[^\n]{0,40}/)}`);
  }

  // Remove everything that legitimately carries brackets (our <a> tags,
  // Markdown links, footnote markers, which have their own check) and flag
  // what is left: [[Artist], {Album}, [[Artist]]] and the like.
  const residue = content
    .replace(/<[^>]+>/g, '')
    .replace(/\[[^\]\n]*\]\([^)\s]*\)/g, '')
    .replace(/\[\d+\]/g, '');
  if (/[[\]{}]/.test(residue)) {
    violations.push(`stray bracket: ${firstMatch(residue, /.{0,20}[[\]{}].{0,20}/)}`);
  }

  const linksProduced = countLinks(content);
  const minLinks = MIN_LINKS[task];
  if (minLinks !== undefined && linksProduced < minLinks) {
    violations.push(`${linksProduced} search links (expected at least ${minLinks})`);
  }

  const albumLinks = countMatches(content, /\]\(\/album\?q=|href="\/album\?q=/g);
  const artistLinks = countMatches(content, /\]\(\/artist\?q=|href="\/artist\?q=/g);
  if (albumLinks !== placeholders.albums) {
    violations.push(`${placeholders.albums} album placeholders became ${albumLinks} links`);
  }
  if (!STRIPS_NESTED_ARTISTS.has(task)) {
    if (artistLinks !== placeholders.artists) {
      violations.push(`${placeholders.artists} artist placeholders became ${artistLinks} links`);
    }
  } else if (raw !== null) {
    const expected = placeholders.artists - countNestedArtists(raw);
    if (artistLinks !== expected) {
      violations.push(`${expected} unnested artist placeholders became ${artistLinks} links`);
    }
  } else if (artistLinks > placeholders.artists) {
    // Saved before rawContent existed: the nested count is unknowable, so only
    // the direction that can never be legitimate is checked.
    violations.push(`${placeholders.artists} artist placeholders became ${artistLinks} links`);
  }

  return violations;
}

/** Every content check. Runtime errors are recorded by the caller, not here. */
function scoreRecord(input: ScoringInput): string[] {
  const { task, content } = input;
  const violations: string[] = [];

  if (FALLBACK_PATTERN.test(content.trim())) {
    violations.push('fallback: model said there is not enough information');
  }

  violations.push(...placeholderViolations(input));
  if (/\]\(https?:\/\//.test(content)) {
    violations.push(`external markdown link: ${firstMatch(content, /\]\(https?:\/\/[^)\s]*/)}`);
  }
  if (/https?:\/\/\S+/.test(content)) {
    violations.push(`raw URL: ${firstMatch(content, /https?:\/\/\S+/)}`);
  }
  if (/\[\d+\]/.test(content)) {
    violations.push(`footnote marker: ${firstMatch(content, /\[\d+\]/)}`);
  }

  if (TITLE_LINE_TASKS.has(task)) {
    const firstLine = content.split('\n').find((line) => line.trim() !== '') ?? '';
    if (/^#{1,6}\s|^\*\*[^*]+\*\*\s*$/.test(firstLine.trim())) {
      violations.push(`heading or title on first line: ${firstLine.trim().slice(0, 60)}`);
    }
  }

  if (task === 'artistSummary' && /^\s*[-*]\s/m.test(content)) {
    violations.push('bullet list in artist summary');
  }

  const modelText = input.raw ?? content;
  const narration = NARRATION_PATTERNS.map((p) => modelText.match(p)?.[0]).find(Boolean);
  if (narration) {
    violations.push(`narration: ${narration.slice(0, 60)}`);
  }

  if (task === 'artistSentence') {
    const selfCorrection = modelText.match(SELF_CORRECTION_PATTERN)?.[0];
    if (selfCorrection) {
      violations.push(`selfCorrection: ${selfCorrection}`);
    }
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    if (words > ARTIST_SENTENCE_MAX_WORDS) {
      violations.push(`wordCount: ${words} words (max ${ARTIST_SENTENCE_MAX_WORDS})`);
    }
  }

  if (task === 'albumRecommendations') {
    const sourceNarration = modelText.match(SOURCE_NARRATION_PATTERN)?.[0];
    if (sourceNarration) {
      violations.push(`sourceNarration: ${sourceNarration}`);
    }
  }

  if (task === 'artistSentence' && /[*#_\[]/.test(content)) {
    violations.push(`Markdown in artist sentence: ${firstMatch(content, /[*#_\[].{0,20}/)}`);
  }

  if (task === 'randomFact' && content.length > 300) {
    violations.push(`random fact is ${content.length} chars (max 300)`);
  }

  if (task === 'userInsightsRecommendations') {
    // content is the raw model text for this task (see buildCases)
    const boldPairs = countMatches(content, /\*\*[^*]+\*\*/g);
    if (boldPairs < 3 || boldPairs > 5) {
      violations.push(`${boldPairs} bold pairs (expected 3-5)`);
    }
    const parsed = input.parsedRecommendations;
    if (parsed !== undefined && parsed !== boldPairs) {
      violations.push(`parser recovered ${parsed} of ${boldPairs} bold entries`);
    }
  }

  if (!input.truncated && !isCacheableResponse(input.raw ?? content, undefined, task, input.label)) {
    violations.push('empty response');
  }

  return violations;
}

function countLinks(content: string): number {
  return countMatches(content, /\]\(\/(?:artist|album)\?q=|href="\/(?:artist|album)\?q=/g);
}

function sumUsage(calls: CommonChatResponse[], field: 'inputTokens' | 'outputTokens'): number | null {
  const values = calls
    .map((c) => c.metadata?.usage?.[field])
    .filter((v): v is number => typeof v === 'number');
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}

async function runCase(evalCase: EvalCase, kv: KVNamespace, keys: { openai: string; anthropic: string }): Promise<EvalRecord> {
  const { task, input } = evalCase;
  const label = describeInput(task, input);
  const ai = new AIService({ openaiApiKey: keys.openai, anthropicApiKey: keys.anthropic, cache: kv });
  const rawCalls = captureRawCalls(ai);

  const started = performance.now();
  let output: CaseOutput = { content: '' };
  let error: string | null = null;
  try {
    output = await evalCase.run(ai, rawCalls);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const ms = Math.round(performance.now() - started);

  // The first call is the generation; a second one (insights scrub pass) is a
  // rewrite whose truncation the prompt function already guards against.
  const primary = rawCalls[0];
  const metadata: Metadata | undefined = primary?.metadata;
  const raw = primary?.content ?? '';
  const truncated = metadata?.truncated ?? false;

  const placeholders = countPlaceholders(raw);
  const violations = error
    ? [`error: ${error}`]
    : scoreRecord({
        task,
        label,
        content: output.content,
        raw,
        placeholders,
        truncated,
        parsedRecommendations: output.parsedRecommendations,
      });

  const config = AI_TASKS[task];
  return {
    task,
    input,
    provider: metadata?.provider ?? config.provider,
    model: metadata?.model ?? config.model,
    content: output.content,
    placeholders,
    linksProduced: countLinks(output.content),
    violations,
    truncated,
    webSearchUsed: metadata?.features?.webSearchUsed ?? false,
    webSearchRequests: metadata?.features?.webSearchRequests ?? null,
    inputTokens: sumUsage(rawCalls, 'inputTokens'),
    outputTokens: sumUsage(rawCalls, 'outputTokens'),
    ms,
    calls: rawCalls.length,
    rawContent: raw,
    ...(output.parsedRecommendations !== undefined && {
      parsedRecommendations: output.parsedRecommendations,
    }),
  };
}

/** Rerun the current checks over a saved record. Runtime errors carry over. */
function rescoreRecord(record: EvalRecord): EvalRecord {
  const carried = record.violations.filter((v) => v.startsWith('error: '));
  if (carried.length) return record;

  // userInsightsRecommendations stores the raw text as content, so it never
  // needs rawContent; every other task falls back to the legacy-safe checks.
  const raw =
    record.rawContent ?? (record.task === 'userInsightsRecommendations' ? record.content : null);
  return {
    ...record,
    linksProduced: countLinks(record.content),
    violations: scoreRecord({
      task: record.task,
      label: describeInput(record.task, record.input),
      content: record.content,
      raw,
      placeholders: record.placeholders,
      truncated: record.truncated,
      parsedRecommendations: record.parsedRecommendations,
    }),
  };
}

/** Run cases with bounded concurrency, preserving input order in the result. */
async function runAll(
  cases: EvalCase[],
  concurrency: number,
  run: (c: EvalCase) => Promise<EvalRecord>
): Promise<EvalRecord[]> {
  const results: EvalRecord[] = new Array(cases.length);
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < cases.length) {
      const index = next++;
      const evalCase = cases[index];
      const record = await run(evalCase);
      results[index] = record;
      done++;
      const status = record.truncated
        ? 'TRUNCATED'
        : record.violations.length
          ? `${record.violations.length} violation(s)`
          : 'ok';
      console.log(`[eval ${done}/${cases.length}] ${evalCase.task} | ${describeInput(evalCase.task, evalCase.input)} | ${(record.ms / 1000).toFixed(1)}s | ${status}`);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function cell(value: unknown): string {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function fmtTokens(n: number | null): string {
  return n === null ? '-' : String(n);
}

function describeInput(task: AITask, input: Record<string, unknown>): string {
  switch (task) {
    case 'albumDetail':
      return `${input.artist} - ${input.album} (${input.year})`;
    case 'albumRecommendations':
      return `${input.artist} - ${input.album}`;
    case 'randomFact':
      return `run ${input.run}`;
    default:
      return String(Object.values(input)[0]);
  }
}

function blockquote(text: string): string {
  if (!text.trim()) return '> _(empty)_';
  return text
    .trim()
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n');
}

/** runInfo: one sentence on where the records came from (live run or rescore). */
function renderSummary(label: string, records: EvalRecord[], runInfo: string): string {
  const lines: string[] = [];
  const total = (field: 'inputTokens' | 'outputTokens') =>
    records.reduce((sum, r) => sum + (r[field] ?? 0), 0);

  lines.push(`# AI eval: ${label}`, '');
  lines.push(
    `${runInfo} ${records.length} rows, ` +
      `${total('inputTokens')} input / ${total('outputTokens')} output tokens.`,
    ''
  );

  const failing = records.filter((r) => r.violations.length || r.truncated);
  lines.push(
    failing.length
      ? `**${failing.length} of ${records.length} rows failed a check.**`
      : 'All rows passed every check.',
    ''
  );

  lines.push('| Task | Provider / model | Rows | Rows with violations | Truncated | Links | Tokens in / out | Total ms |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const task of TASK_ORDER) {
    const rows = records.filter((r) => r.task === task);
    if (!rows.length) continue;
    const models = [...new Set(rows.map((r) => `${r.provider} / ${r.model}`))].join(', ');
    const sum = (f: (r: EvalRecord) => number) => rows.reduce((s, r) => s + f(r), 0);
    lines.push(
      `| ${task} | ${cell(models)} | ${rows.length} | ${rows.filter((r) => r.violations.length).length} | ` +
        `${rows.filter((r) => r.truncated).length} | ${sum((r) => r.linksProduced)} | ` +
        `${sum((r) => r.inputTokens ?? 0)} / ${sum((r) => r.outputTokens ?? 0)} | ${sum((r) => r.ms)} |`
    );
  }
  lines.push('');

  for (const task of TASK_ORDER) {
    const rows = records.filter((r) => r.task === task);
    if (!rows.length) continue;

    lines.push(`## ${task}`, '');
    lines.push('| Input | Truncated | Violations | Links | Placeholders (artist / album) | Web search | Tokens in / out | ms |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const search = r.webSearchUsed
        ? `yes${r.webSearchRequests !== null ? ` (${r.webSearchRequests})` : ''}`
        : 'no';
      lines.push(
        `| ${cell(describeInput(r.task, r.input))} | ${r.truncated ? '**yes**' : 'no'} | ` +
          `${r.violations.length ? cell(r.violations.join('; ')) : '-'} | ${r.linksProduced} | ` +
          `${r.placeholders.artists} / ${r.placeholders.albums} | ${search} | ` +
          `${fmtTokens(r.inputTokens)} / ${fmtTokens(r.outputTokens)} | ${r.ms} |`
      );
    }
    lines.push('');

    for (const r of rows) {
      lines.push(`### ${task}: ${describeInput(r.task, r.input)}`, '');
      lines.push(blockquote(r.content), '');
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

/** Live run: one API call (or two) per case. */
async function runEval(
  concurrency: number,
  tasks: AITask[]
): Promise<{ records: EvalRecord[]; runInfo: string }> {
  const inputs = JSON.parse(readFileSync(join(SCRIPT_DIR, 'ai-eval-inputs.json'), 'utf8')) as EvalInputs;

  const devVars = readDevVars(join(WEB_ROOT, '.dev.vars'));
  const providers = new Set(tasks.map((t) => AI_TASKS[t].provider as string));
  const keys = {
    openai: resolveKey('OPENAI_API_KEY', devVars, providers.has('openai')),
    anthropic: resolveKey('ANTHROPIC_API_KEY', devVars, providers.has('anthropic')),
  };

  const cases = buildCases(inputs).filter((c) => tasks.includes(c.task));
  const scope = tasks.length === TASK_ORDER.length ? 'all tasks' : tasks.join(', ');
  console.log(`[eval] ${cases.length} cases (${scope}), concurrency ${concurrency}`);

  const kv = createMemoryKV();
  const started = performance.now();
  const records = await runAll(cases, concurrency, (c) => runCase(c, kv, keys));
  const wallSeconds = ((performance.now() - started) / 1000).toFixed(0);

  return {
    records,
    runInfo: `Run ${new Date().toISOString()} at ${gitRef()}, wall time ${wallSeconds}s.`,
  };
}

/** No API calls: the current checks over a saved run's records. */
function rescoreEval(sourceLabel: string): EvalRecord[] {
  const sourceDir = join(WEB_ROOT, 'eval-output', sourceLabel);
  if (!existsSync(sourceDir)) {
    throw new Error(`No saved run at ${sourceDir}`);
  }
  return TASK_ORDER.flatMap((task) => {
    const path = join(sourceDir, `${task}.json`);
    if (!existsSync(path)) return [];
    return (JSON.parse(readFileSync(path, 'utf8')) as EvalRecord[]).map(rescoreRecord);
  });
}

async function main(): Promise<number> {
  const { mode, label, concurrency, tasks } = parseArgs(process.argv.slice(2));

  let records: EvalRecord[];
  let outLabel: string;
  let runInfo: string;
  if (mode === 'rescore') {
    records = rescoreEval(label);
    outLabel = `${label}-rescored`;
    runInfo = `Rescored ${new Date().toISOString()} from saved run "${label}" with the checks at ${gitRef()}; no API calls.`;
  } else {
    ({ records, runInfo } = await runEval(concurrency, tasks));
    outLabel = label;
  }

  const outDir = join(WEB_ROOT, 'eval-output', outLabel);
  mkdirSync(outDir, { recursive: true });
  // Tasks left out by --only get no file, so a later --rescore skips them.
  for (const task of TASK_ORDER) {
    const rows = records.filter((r) => r.task === task);
    if (!rows.length) continue;
    writeFileSync(join(outDir, `${task}.json`), `${JSON.stringify(rows, null, 2)}\n`);
  }
  writeFileSync(join(outDir, 'summary.md'), renderSummary(outLabel, records, runInfo));

  const failing = records.filter((r) => r.violations.length || r.truncated);
  console.log(`[eval] Wrote ${outDir}/summary.md (${records.length} rows, ${failing.length} failing)`);
  for (const r of failing) {
    const reasons = [...(r.truncated ? ['truncated'] : []), ...r.violations];
    console.log(`[eval]   ${r.task} | ${describeInput(r.task, r.input)} | ${reasons.join('; ')}`);
  }

  return failing.length ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error('[eval] Run failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  }
);
