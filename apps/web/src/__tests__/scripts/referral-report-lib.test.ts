// ABOUTME: Tests for the pure helpers behind scripts/referral-report.ts: date-bounded report SQL,
// ABOUTME: date and ref validation, and the plain-text report with its conversion figure.

import { describe, it, expect } from 'vitest';
import { buildReferralReportSql, formatReferralReport } from '../../../scripts/referral-report-lib';

describe('buildReferralReportSql', () => {
  it('builds date-bounded queries for the ref', () => {
    const [clicks, signups] = buildReferralReportSql('lastfm-mcp', '2026-11-01', '2026-12-01');
    for (const sql of [clicks, signups]) {
      expect(sql).toContain("'lastfm-mcp'");
      expect(sql).toContain("'2026-11-01'");
      expect(sql).toContain("'2026-12-01'");
    }
    expect(clicks).toContain('FROM referral_clicks');
    expect(signups).toContain('FROM users');
  });

  it('rejects malformed dates', () => {
    expect(() => buildReferralReportSql('lastfm-mcp', "2026-11-01' OR 1=1", '2026-12-01')).toThrow();
    expect(() => buildReferralReportSql('lastfm-mcp', '2026-11-01', '2026-13-01')).toThrow();
  });

  it('rejects a range that ends before it starts', () => {
    expect(() => buildReferralReportSql('lastfm-mcp', '2026-12-01', '2026-11-01')).toThrow();
  });
});

describe('formatReferralReport', () => {
  const clicks = { total: 50, matched: 30, missed: 20, human: 40, bot: 10 };

  it('formats conversion as a percentage of human clicks', () => {
    const report = formatReferralReport({
      ref: 'lastfm-mcp',
      from: '2026-11-01',
      to: '2026-12-01',
      clicks,
      signups: 2,
    });
    expect(report.endsWith('Conversion (sign-ups ÷ human clicks, counts requests not people): 5.0%')).toBe(true);
  });

  it('prints n/a when there are no human clicks', () => {
    const report = formatReferralReport({
      ref: 'lastfm-mcp',
      from: '2026-11-01',
      to: '2026-12-01',
      clicks: { total: 3, matched: 0, missed: 3, human: 0, bot: 3 },
      signups: 0,
    });
    expect(report.endsWith('counts requests not people): n/a')).toBe(true);
  });
});
