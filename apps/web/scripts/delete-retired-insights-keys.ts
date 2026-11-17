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
// and counts only. A failed wrangler call is reported by operation, prefix
// and exit status; its output is discarded. Every KV call shells out to
// `npx wrangler ... --remote`, so this acts on production.

import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cacheNamespaceId } from './cached-summaries-lib';
import {
  RETIRED_PREFIXES,
  exitStatus,
  parseKeyList,
  wranglerFailureMessage,
} from './delete-retired-insights-keys-lib';
import type { RetiredPrefix, WranglerOperation } from './delete-retired-insights-keys-lib';

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(SCRIPT_DIR, '..');
const OUTPUT_DIR = join(WEB_ROOT, 'eval-output');

const USAGE = 'Usage: delete-retired-insights-keys.ts [--yes]';

/**
 * A failure whose message the script wrote itself and knows holds no key name.
 * The top-level handler prints only these messages; any other error is
 * reported by its name alone.
 */
class ScriptFailure extends Error {}

function parseArgs(argv: string[]): { yes: boolean } {
  let yes = false;
  for (const arg of argv) {
    if (arg === '--yes') yes = true;
    else throw new ScriptFailure(`Unknown argument ${arg}\n${USAGE}`);
  }
  return { yes };
}

function namespaceId(): string {
  try {
    return cacheNamespaceId(readFileSync(join(WEB_ROOT, 'wrangler.toml'), 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ScriptFailure(`Could not read the CACHE namespace id: ${message}`);
  }
}

/**
 * Run wrangler from apps/web. On failure, wrangler's stdout, stderr and the
 * error message are discarded, since they can quote key names; the rejection
 * names only the operation, the prefix and the exit status.
 */
async function wrangler(operation: WranglerOperation, prefix: RetiredPrefix, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('npx', ['wrangler', ...args], {
      cwd: WEB_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new ScriptFailure(wranglerFailureMessage(operation, prefix, error));
  }
}

async function listKeys(nsId: string, prefix: RetiredPrefix): Promise<string[]> {
  const args = ['kv', 'key', 'list', '--namespace-id', nsId, '--prefix', prefix, '--remote'];
  const stdout = await wrangler('list', prefix, args);
  try {
    return parseKeyList(stdout);
  } catch {
    throw new ScriptFailure(`wrangler list returned unexpected output for ${prefix}`);
  }
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
async function bulkDelete(nsId: string, prefix: RetiredPrefix, names: string[]): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const dir = mkdtempSync(join(OUTPUT_DIR, 'retired-insights-keys-'));
  try {
    const file = join(dir, 'keys.json');
    writeFileSync(file, JSON.stringify(names));
    const args = ['kv', 'bulk', 'delete', file, '--namespace-id', nsId, '--remote', '--force'];
    await wrangler('bulk delete', prefix, args);
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
    await bulkDelete(nsId, prefix, names);
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

main().catch((error: unknown) => {
  // Only ScriptFailure messages are known to hold no key name; anything else
  // is reported by its name and a fixed status token such as ENOENT.
  let message: string;
  if (error instanceof ScriptFailure) {
    message = error.message;
  } else {
    const status = exitStatus(error);
    message = `unexpected ${error instanceof Error ? error.name : typeof error}${status ? ` (${status})` : ''}`;
  }
  console.error('[delete-retired-insights-keys] Failed:', message);
  process.exitCode = 1;
});
