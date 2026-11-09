// ABOUTME: Prints lookup click and sign-up counts for one referrer and date range, read from production D1.
// ABOUTME: Each query shells out to `wrangler d1 execute --remote`, so every run reads production.
//
// Usage (from apps/web):
//   pnpm dlx tsx scripts/referral-report.ts [--ref lastfm-mcp] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//
// Defaults: --ref lastfm-mcp, and the last 30 UTC days (from 29 days ago through today).
// --to is exclusive, the same as the SQL. --ref must be a known referrer (parseRef).
// The report goes to stdout and progress to stderr. The SQL lives in referral-report-lib.ts.

import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { KNOWN_REFS, parseRef } from '../src/utils/referral';
import type { Ref } from '../src/utils/referral';
import { buildReferralReportSql, formatReferralReport } from './referral-report-lib';

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(SCRIPT_DIR, '..');
const D1_DATABASE = 'listentomore';
const DEFAULT_REF: Ref = 'lastfm-mcp';
const DAY_MS = 86_400_000;

const USAGE = 'Usage: referral-report.ts [--ref lastfm-mcp] [--from YYYY-MM-DD] [--to YYYY-MM-DD]';
const VALUED_FLAGS = ['--ref', '--from', '--to'];

interface CliArgs {
  ref: Ref;
  from: string;
  to: string;
}

/** YYYY-MM-DD in UTC, offsetDays from today. created_at is stored in UTC. */
function utcDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): CliArgs {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!VALUED_FLAGS.includes(flag)) throw new Error(`Unknown argument ${flag}\n${USAGE}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value\n${USAGE}`);
    values.set(flag, value);
  }

  const requestedRef = values.get('--ref') ?? DEFAULT_REF;
  const ref = parseRef(requestedRef);
  if (ref === null) {
    throw new Error(`Unknown --ref ${JSON.stringify(requestedRef)}; known refs: ${KNOWN_REFS.join(', ')}`);
  }
  return {
    ref,
    from: values.get('--from') ?? utcDate(-29),
    to: values.get('--to') ?? utcDate(1),
  };
}

/** The first row of the first statement in `wrangler d1 execute --json` output. */
async function d1FirstRow(sql: string): Promise<Record<string, unknown>> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      'npx',
      ['wrangler', 'd1', 'execute', D1_DATABASE, '--remote', '--json', '--command', sql],
      { cwd: WEB_ROOT, maxBuffer: 16 * 1024 * 1024 },
    ));
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`wrangler d1 execute failed: ${stderr || message}`);
  }

  const parsed: unknown = JSON.parse(stdout);
  const row = (parsed as Array<{ results?: Array<Record<string, unknown>> }>)[0]?.results?.[0];
  if (row === undefined) throw new Error(`Unexpected d1 output for query: ${sql}`);
  return row;
}

function integerField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Expected an integer ${key} in the D1 result, got ${JSON.stringify(value)}`);
  }
  return value;
}

async function main(): Promise<void> {
  const { ref, from, to } = parseArgs(process.argv.slice(2));
  const [clicksSql, signupsSql] = buildReferralReportSql(ref, from, to);

  console.error(`[referral-report] Querying production D1 for ref=${ref}, ${from} to ${to}`);
  const clicks = await d1FirstRow(clicksSql);
  const signups = await d1FirstRow(signupsSql);

  console.log(
    formatReferralReport({
      ref,
      from,
      to,
      clicks: {
        total: integerField(clicks, 'total'),
        matched: integerField(clicks, 'matched'),
        missed: integerField(clicks, 'missed'),
        human: integerField(clicks, 'human'),
        humanSignedOut: integerField(clicks, 'human_signed_out'),
        bot: integerField(clicks, 'bot'),
      },
      signups: integerField(signups, 'signups'),
    }),
  );
}

main().catch((error) => {
  console.error('[referral-report] Failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
