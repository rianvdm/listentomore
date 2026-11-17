// ABOUTME: One-off cleanup after the insights simplification: counts and deletes the production CACHE KV
// ABOUTME: keys for the retired insights question, card and trivia entries and the MusicBrainz credits.
//
// Usage (from apps/web):
//   pnpm dlx tsx scripts/delete-retired-insights-keys.ts [--yes]
//
// Without --yes it is read-only: for each prefix in RETIRED_PREFIXES it lists
// the keys and prints the prefix and its count.
//
// With --yes it also deletes them. For each prefix with keys it writes the
// names as a JSON array to a temporary file under eval-output/, runs
// `wrangler kv bulk delete`, and removes the file even when wrangler fails.
// It then lists every prefix again and exits 1 unless every count is 0.
//
// Key names hold usernames and artist names, so the script prints prefixes
// and counts only. Every KV call shells out to `npx wrangler ... --remote`,
// so this acts on production.

import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cacheNamespaceId } from './cached-summaries-lib';
import { RETIRED_PREFIXES, parseKeyList } from './delete-retired-insights-keys-lib';

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(SCRIPT_DIR, '..');
const OUTPUT_DIR = join(WEB_ROOT, 'eval-output');

const USAGE = 'Usage: delete-retired-insights-keys.ts [--yes]';

type RetiredPrefix = (typeof RETIRED_PREFIXES)[number];

function parseArgs(argv: string[]): { yes: boolean } {
  let yes = false;
  for (const arg of argv) {
    if (arg === '--yes') yes = true;
    else throw new Error(`Unknown argument ${arg}\n${USAGE}`);
  }
  return { yes };
}

function namespaceId(): string {
  return cacheNamespaceId(readFileSync(join(WEB_ROOT, 'wrangler.toml'), 'utf8'));
}

/** Run wrangler from apps/web; rejects on a non-zero exit with stderr in the message. */
async function wrangler(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('npx', ['wrangler', ...args], {
      cwd: WEB_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed: ${stderr || message}`);
  }
}

async function listKeys(nsId: string, prefix: RetiredPrefix): Promise<string[]> {
  const stdout = await wrangler(['kv', 'key', 'list', '--namespace-id', nsId, '--prefix', prefix, '--remote']);
  return parseKeyList(stdout);
}

/** List every retired prefix, printing each prefix with its count. */
async function listAll(nsId: string, label: string): Promise<Map<RetiredPrefix, string[]>> {
  const keys = new Map<RetiredPrefix, string[]>();
  for (const prefix of RETIRED_PREFIXES) {
    const names = await listKeys(nsId, prefix);
    keys.set(prefix, names);
    console.log(`[${label}] ${prefix} ${names.length}`);
  }
  return keys;
}

/** Bulk-delete one prefix's keys through a temporary file that is always removed. */
async function bulkDelete(nsId: string, names: string[]): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const dir = mkdtempSync(join(OUTPUT_DIR, 'retired-insights-keys-'));
  try {
    const file = join(dir, 'keys.json');
    writeFileSync(file, JSON.stringify(names));
    await wrangler(['kv', 'bulk', 'delete', file, '--namespace-id', nsId, '--remote', '--force']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { yes } = parseArgs(process.argv.slice(2));
  const nsId = namespaceId();

  const before = await listAll(nsId, 'list');
  if (!yes) {
    console.log('[list] Dry run: nothing deleted. Pass --yes to delete these keys.');
    return;
  }

  for (const [prefix, names] of before) {
    if (!names.length) continue;
    await bulkDelete(nsId, names);
    console.log(`[delete] ${prefix} deleted ${names.length}`);
  }

  const after = await listAll(nsId, 'verify');
  const remaining = [...after.values()].reduce((sum, names) => sum + names.length, 0);
  if (remaining > 0) {
    console.error(`[verify] ${remaining} keys remain under the retired prefixes`);
    process.exitCode = 1;
    return;
  }
  console.log('[verify] Every retired prefix is empty.');
}

main().catch((error) => {
  console.error('[delete-retired-insights-keys] Failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
