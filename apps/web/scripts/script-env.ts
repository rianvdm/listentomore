// ABOUTME: Shared setup for the insights scripts: reads keys from apps/web/.dev.vars and provides an in-memory
// ABOUTME: KVNamespace that counts its operations and the bytes written under each key.

import { existsSync, readFileSync } from 'node:fs';

/** Parse KEY=value lines from a .dev.vars file. Values may be quoted. */
export function readDevVars(path: string): Record<string, string> {
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

export interface KvOps {
  gets: number;
  hits: number;
  puts: number;
  deletes: number;
  lists: number;
}

export interface MemoryKV {
  kv: KVNamespace;
  /** Every stored value by key. */
  store: Map<string, string>;
  /** Operations since the last resetCounters(). */
  ops: KvOps;
  /** UTF-8 value bytes of each put since the last resetCounters(), in order. */
  writes: Array<{ key: string; bytes: number }>;
  resetCounters(): void;
}

const utf8 = new TextEncoder();
export const byteLength = (s: string): number => utf8.encode(s).length;

/**
 * Map-backed KVNamespace stand-in with get (text or json), put, delete and list. Expiry is ignored: a script run
 * is far shorter than any TTL. A fresh one per run means nothing is served from an earlier run's cache.
 */
export function createMemoryKV(): MemoryKV {
  const store = new Map<string, string>();
  const state: MemoryKV = {
    kv: undefined as unknown as KVNamespace,
    store,
    ops: { gets: 0, hits: 0, puts: 0, deletes: 0, lists: 0 },
    writes: [],
    resetCounters() {
      state.ops = { gets: 0, hits: 0, puts: 0, deletes: 0, lists: 0 };
      state.writes = [];
    },
  };
  const stub = {
    async get(key: string, type?: string | { type?: string }) {
      state.ops.gets++;
      const value = store.get(key);
      if (value === undefined) return null;
      state.ops.hits++;
      const kind = typeof type === 'string' ? type : type?.type;
      return kind === 'json' ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) {
      state.ops.puts++;
      state.writes.push({ key, bytes: byteLength(value) });
      store.set(key, value);
    },
    async delete(key: string) {
      state.ops.deletes++;
      store.delete(key);
    },
    async list(options?: { prefix?: string }) {
      state.ops.lists++;
      const prefix = options?.prefix ?? '';
      return {
        keys: [...store.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      };
    },
  };
  state.kv = stub as unknown as KVNamespace;
  return state;
}
