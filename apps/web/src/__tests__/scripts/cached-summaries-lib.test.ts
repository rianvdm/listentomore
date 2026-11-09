// ABOUTME: Tests for the pure helpers behind scripts/cached-summaries.ts: audit flags, Spotify matching,
// ABOUTME: cache key parsing, the CACHE namespace lookup in wrangler.toml, and SQL escaping for the backfill.

import { describe, it, expect } from 'vitest';
import {
  auditFlags,
  cacheNamespaceId,
  classifyRefreshValue,
  entityPageInsert,
  parseSummaryKey,
  pickSpotifyMatch,
  summaryText,
} from '../../../scripts/cached-summaries-lib';

// A clean summary: long enough, ends on a full stop, balanced Markdown.
const CLEAN_SUMMARY =
  '**OK Computer** is the third studio album by Radiohead, released in 1997. ' +
  'It moved the band away from the guitar anthems of The Bends toward layered, ' +
  'electronic textures and lyrics about alienation, technology and modern life. ' +
  'Critics placed it among the best albums of the decade.';

const CLEAN_RECOMMENDATIONS =
  '1. **Kid A** by Radiohead: a colder, more electronic follow-up.\n' +
  '2. **Mezzanine** by Massive Attack: dense and dark.';

describe('auditFlags', () => {
  it('returns no flags for a clean summary', () => {
    expect(auditFlags('albumDetail', CLEAN_SUMMARY)).toEqual([]);
  });

  it('returns no flags for clean recommendations above the shorter floor', () => {
    expect(auditFlags('albumRecommendations', CLEAN_RECOMMENDATIONS)).toEqual([]);
  });

  it('flags empty text and nothing else', () => {
    expect(auditFlags('artistSummary', '   \n ')).toEqual(['empty']);
  });

  it('flags a "Not enough information available" reply', () => {
    const text = `Not enough information available about this album. ${CLEAN_SUMMARY}`;
    expect(auditFlags('albumDetail', text)).toContain('not-enough-information');
  });

  it('flags a summary under 200 characters', () => {
    expect(auditFlags('genreSummary', 'Shoegaze is loud and dreamy.')).toContain('short');
  });

  it('flags recommendations under 100 characters but not between 100 and 199', () => {
    expect(auditFlags('albumRecommendations', '1. **Kid A** by Radiohead.')).toContain('short');
    expect(CLEAN_RECOMMENDATIONS.length).toBeGreaterThanOrEqual(100);
    expect(CLEAN_RECOMMENDATIONS.length).toBeLessThan(200);
    expect(auditFlags('albumRecommendations', CLEAN_RECOMMENDATIONS)).not.toContain('short');
  });

  it('flags text whose last character is not closing punctuation', () => {
    expect(auditFlags('albumDetail', `${CLEAN_SUMMARY} The band then`)).toContain('no-final-punctuation');
  });

  it.each(['.', '!', '?', ')', '"', "'", '*', '_', ']', '}'])(
    'accepts %s as final punctuation, ignoring trailing whitespace',
    (mark) => {
      const text = `${CLEAN_SUMMARY.slice(0, -1)}${mark}  \n`;
      expect(auditFlags('albumDetail', text)).not.toContain('no-final-punctuation');
    }
  );

  it('flags an odd number of bold markers', () => {
    expect(auditFlags('albumDetail', `**Unclosed bold ${CLEAN_SUMMARY}`)).toContain('unbalanced-markdown');
  });

  it('flags mismatched artist and album placeholders', () => {
    expect(auditFlags('artistSummary', `[[Radiohead ${CLEAN_SUMMARY}`)).toContain('unbalanced-markdown');
    expect(auditFlags('artistSummary', `{{OK Computer ${CLEAN_SUMMARY}`)).toContain('unbalanced-markdown');
  });

  it.each(['An error occurred.', 'I was unable to find this.', 'I cannot help with that.', 'As an AI, I lack taste.'])(
    'flags error text: %s',
    (phrase) => {
      expect(auditFlags('albumDetail', `${CLEAN_SUMMARY} ${phrase.toUpperCase()}`)).toContain('error-text');
    }
  );

  it('does not flag words that merely contain "error", such as terror', () => {
    expect(auditFlags('albumDetail', `${CLEAN_SUMMARY} Reign of Terror followed.`)).not.toContain('error-text');
  });
});

describe('pickSpotifyMatch', () => {
  it('returns the id of an exact album and artist match', () => {
    const results = [
      { id: 'other', name: 'The Bends', artist: 'Radiohead' },
      { id: 'okc', name: 'OK Computer', artist: 'Radiohead' },
    ];
    expect(pickSpotifyMatch({ artist: 'Radiohead', album: 'OK Computer' }, results)).toBe('okc');
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    const results = [{ id: 'okc', name: ' OK Computer', artist: 'RADIOHEAD ' }];
    expect(pickSpotifyMatch({ artist: 'radiohead', album: 'ok computer' }, results)).toBe('okc');
  });

  it('returns null for a near miss', () => {
    const results = [{ id: 'oknotok', name: 'OK Computer OKNOTOK 1997 2017', artist: 'Radiohead' }];
    expect(pickSpotifyMatch({ artist: 'radiohead', album: 'ok computer' }, results)).toBeNull();
  });

  it('requires the artist to match for an album', () => {
    const results = [{ id: 'cover', name: 'OK Computer', artist: 'Vitamin String Quartet' }];
    expect(pickSpotifyMatch({ artist: 'radiohead', album: 'ok computer' }, results)).toBeNull();
  });

  it('matches an artist by name when no album is wanted', () => {
    const results = [
      { id: 'tribute', name: 'Radiohead Tribute Band' },
      { id: 'rh', name: 'Radiohead' },
    ];
    expect(pickSpotifyMatch({ artist: 'radiohead' }, results)).toBe('rh');
  });
});

describe('parseSummaryKey', () => {
  it('splits an album key into artist and album at the first colon', () => {
    expect(parseSummaryKey('ai:albumDetail:radiohead:ok computer')).toEqual({
      task: 'albumDetail',
      names: ['radiohead', 'ok computer'],
    });
  });

  it('keeps later colons in the album name', () => {
    expect(parseSummaryKey('ai:albumRecommendations:sufjan stevens:michigan: the album')).toEqual({
      task: 'albumRecommendations',
      names: ['sufjan stevens', 'michigan: the album'],
    });
  });

  it('keeps colons inside a single-name key', () => {
    expect(parseSummaryKey('ai:artistSummary:sunn o))): live')).toEqual({
      task: 'artistSummary',
      names: ['sunn o))): live'],
    });
  });

  it('rejects keys outside the four summary tasks or with missing names', () => {
    expect(parseSummaryKey('ai:randomFact:1')).toBeNull();
    expect(parseSummaryKey('spotify:search:album:x')).toBeNull();
    expect(parseSummaryKey('ai:albumDetail:no-album-part')).toBeNull();
    expect(parseSummaryKey('ai:genreSummary:')).toBeNull();
  });
});

describe('summaryText', () => {
  it('reads content for album and genre tasks and summary for artists', () => {
    expect(summaryText('albumDetail', { content: 'A' })).toBe('A');
    expect(summaryText('albumRecommendations', { content: 'B' })).toBe('B');
    expect(summaryText('genreSummary', { content: 'C' })).toBe('C');
    expect(summaryText('artistSummary', { summary: 'D' })).toBe('D');
  });

  it('returns null when the field is missing or not a string', () => {
    expect(summaryText('artistSummary', { content: 'wrong field' })).toBeNull();
    expect(summaryText('albumDetail', { content: 42 })).toBeNull();
    expect(summaryText('albumDetail', null)).toBeNull();
    expect(summaryText('albumDetail', 'plain string')).toBeNull();
  });
});

describe('classifyRefreshValue', () => {
  const KEY = 'ai:albumDetail:radiohead:ok computer';

  it('refreshes a normal value, writing back the parsed JSON', () => {
    const raw = JSON.stringify({ content: CLEAN_SUMMARY });

    expect(classifyRefreshValue('albumDetail', KEY, raw)).toEqual({ outcome: 'refresh', body: raw });
  });

  it('reads the artist summary field', () => {
    const raw = JSON.stringify({ summary: CLEAN_SUMMARY });

    expect(classifyRefreshValue('artistSummary', 'ai:artistSummary:radiohead', raw).outcome).toBe('refresh');
  });

  it('fails a value that is not JSON', () => {
    expect(classifyRefreshValue('albumDetail', KEY, '{"content": "cut off')).toEqual({
      outcome: 'failed',
      reason: 'not valid JSON',
    });
  });

  it('fails a value without its text field', () => {
    expect(classifyRefreshValue('artistSummary', 'ai:artistSummary:radiohead', '{"content":"wrong field"}')).toEqual({
      outcome: 'failed',
      reason: 'missing its text field',
    });
    expect(classifyRefreshValue('albumDetail', KEY, 'null').outcome).toBe('failed');
  });

  it('fails a value whose text is empty or whitespace', () => {
    expect(classifyRefreshValue('albumDetail', KEY, '{"content":""}')).toEqual({
      outcome: 'failed',
      reason: 'empty text',
    });
    expect(classifyRefreshValue('albumDetail', KEY, '{"content":"  \\n "}').outcome).toBe('failed');
  });
});

describe('cacheNamespaceId', () => {
  it('reads the id of the CACHE binding, not another namespace or the preview id', () => {
    const toml = [
      'name = "listentomore-web"',
      '',
      '[[kv_namespaces]]',
      'binding = "OTHER"',
      'id = "other-id"',
      '',
      '[[kv_namespaces]]',
      'binding = "CACHE"',
      'id = "cache-id"',
      'preview_id = "preview-id"',
      '',
      '[[d1_databases]]',
      'binding = "DB"',
      'database_id = "db-id"',
    ].join('\n');
    expect(cacheNamespaceId(toml)).toBe('cache-id');
  });

  it('throws when no CACHE namespace is configured', () => {
    expect(() => cacheNamespaceId('[[kv_namespaces]]\nbinding = "OTHER"\nid = "x"\n')).toThrow(/CACHE/);
  });
});

describe('entityPageInsert', () => {
  it('builds an INSERT OR IGNORE row with single quotes escaped', () => {
    expect(
      entityPageInsert({ cacheKey: "ai:albumDetail:guns n' roses:appetite", type: 'album', path: '/album/abc' })
    ).toBe(
      "INSERT OR IGNORE INTO entity_pages (cache_key, type, path) VALUES ('ai:albumDetail:guns n'' roses:appetite', 'album', '/album/abc');"
    );
  });
});
