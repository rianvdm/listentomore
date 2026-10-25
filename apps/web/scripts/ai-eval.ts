// ABOUTME: Throwaway quality gate that runs every AI task against fixed inputs via AIService.
// ABOUTME: Writes per-task JSON and a summary.md to eval-output/<label>/ for provider comparison.
//
// Usage (from apps/web):
//   pnpm dlx tsx scripts/ai-eval.ts --label openai-baseline [--concurrency 4]
//
// Spends real money: every case is a live API call, and nothing is served from
// cache because each run gets a fresh in-memory KV. Exit code 1 means at least
// one record has a violation or was truncated; 2 means the run could not start.

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

const FALLBACK_PATTERN =
  /^(Not enough information available|There is no information available)/i;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(SCRIPT_DIR, '..');

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { label: string; concurrency: number } {
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const label = valueOf('--label');
  if (!label || !/^[\w.-]+$/.test(label)) {
    throw new Error('--label <name> is required (letters, digits, dot, dash, underscore)');
  }

  const concurrency = Number(valueOf('--concurrency') ?? 4);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('--concurrency must be a positive integer');
  }

  return { label, concurrency };
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

/** Resolve a secret, process.env first. Required only if a task routes to it. */
function resolveKey(name: string, devVars: Record<string, string>, required: boolean): string {
  const value = process.env[name] || devVars[name] || '';
  if (required && !value) {
    throw new Error(`${name} is not set in process.env or apps/web/.dev.vars`);
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

function findViolations(task: AITask, output: CaseOutput, raw: string): string[] {
  const { content } = output;
  const violations: string[] = [];

  if (FALLBACK_PATTERN.test(content.trim())) {
    violations.push('fallback: model said there is not enough information');
  }

  // The owner's top concern: a placeholder the substitution step did not
  // replace renders as literal brackets on the page.
  if (/\[\[|\{\{/.test(content)) {
    violations.push(`unreplaced placeholder: ${firstMatch(content, /(\[\[|\{\{)[^\n]{0,40}/)}`);
  }
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

  if (task === 'artistSentence' && /[*#_\[]/.test(content)) {
    violations.push(`Markdown in artist sentence: ${firstMatch(content, /[*#_\[].{0,20}/)}`);
  }

  if (task === 'randomFact' && content.length > 300) {
    violations.push(`random fact is ${content.length} chars (max 300)`);
  }

  if (task === 'userInsightsRecommendations') {
    const boldPairs = countMatches(raw, /\*\*[^*]+\*\*/g);
    if (boldPairs < 3 || boldPairs > 5) {
      violations.push(`${boldPairs} bold pairs (expected 3-5)`);
    }
    const parsed = output.parsedRecommendations ?? 0;
    if (parsed !== boldPairs) {
      violations.push(`parser recovered ${parsed} of ${boldPairs} bold entries`);
    }
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

  const violations = error ? [`error: ${error}`] : findViolations(task, output, raw);
  if (!error && !truncated && !isCacheableResponse(raw, metadata, task, label)) {
    violations.push('empty response');
  }

  const config = AI_TASKS[task];
  return {
    task,
    input,
    provider: metadata?.provider ?? config.provider,
    model: metadata?.model ?? config.model,
    content: output.content,
    placeholders: {
      artists: countMatches(raw, /\[\[[^\]]+\]\]/g),
      albums: countMatches(raw, /\{\{[^}]+\}\}/g),
    },
    linksProduced: countLinks(output.content),
    violations,
    truncated,
    webSearchUsed: metadata?.features?.webSearchUsed ?? false,
    webSearchRequests: metadata?.features?.webSearchRequests ?? null,
    inputTokens: sumUsage(rawCalls, 'inputTokens'),
    outputTokens: sumUsage(rawCalls, 'outputTokens'),
    ms,
    calls: rawCalls.length,
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

function renderSummary(label: string, records: EvalRecord[], wallMs: number, ref: string): string {
  const lines: string[] = [];
  const total = (field: 'inputTokens' | 'outputTokens') =>
    records.reduce((sum, r) => sum + (r[field] ?? 0), 0);

  lines.push(`# AI eval: ${label}`, '');
  lines.push(
    `Run ${new Date().toISOString()} at ${ref}. ${records.length} rows, ` +
      `wall time ${(wallMs / 1000).toFixed(0)}s, ` +
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

async function main(): Promise<number> {
  const { label, concurrency } = parseArgs(process.argv.slice(2));
  const inputs = JSON.parse(readFileSync(join(SCRIPT_DIR, 'ai-eval-inputs.json'), 'utf8')) as EvalInputs;

  const devVars = readDevVars(join(WEB_ROOT, '.dev.vars'));
  const providers = new Set(TASK_ORDER.map((t) => AI_TASKS[t].provider as string));
  const keys = {
    openai: resolveKey('OPENAI_API_KEY', devVars, providers.has('openai')),
    anthropic: resolveKey('ANTHROPIC_API_KEY', devVars, providers.has('anthropic')),
  };

  const cases = buildCases(inputs);
  console.log(`[eval] ${label}: ${cases.length} cases, concurrency ${concurrency}`);

  const kv = createMemoryKV();
  const started = performance.now();
  const records = await runAll(cases, concurrency, (c) => runCase(c, kv, keys));
  const wallMs = Math.round(performance.now() - started);

  const outDir = join(WEB_ROOT, 'eval-output', label);
  mkdirSync(outDir, { recursive: true });
  for (const task of TASK_ORDER) {
    const rows = records.filter((r) => r.task === task);
    writeFileSync(join(outDir, `${task}.json`), `${JSON.stringify(rows, null, 2)}\n`);
  }
  writeFileSync(join(outDir, 'summary.md'), renderSummary(label, records, wallMs, gitRef()));

  const failing = records.filter((r) => r.violations.length || r.truncated);
  console.log(`[eval] Wrote ${outDir}/summary.md (${records.length} rows, ${failing.length} failing, ${(wallMs / 1000).toFixed(0)}s)`);
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
