// ABOUTME: Pure helpers for scripts/referral-report.ts: date-bounded SQL for referral clicks and sign-ups,
// ABOUTME: and the plain-text report with its sign-ups per human click conversion figure.

import { parseRef } from '../src/utils/referral';
import type { Ref } from '../src/utils/referral';

export interface ClickCounts {
  total: number;
  matched: number;
  missed: number;
  human: number;
  bot: number;
}

export interface ReferralReportInput {
  ref: string;
  from: string;
  to: string;
  clicks: ClickCounts;
  signups: number;
}

/** A calendar date as YYYY-MM-DD, rejecting values such as 2026-02-30. */
function assertDate(value: string, label: string): void {
  const time = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a YYYY-MM-DD date, got ${JSON.stringify(value)}`);
  }
}

/**
 * Two SELECTs for one ref: click counts from referral_clicks, and sign-ups from users.signup_ref.
 * Both cover created_at >= from and created_at < to, so `to` is exclusive. SQLite's datetime('now')
 * stores 'YYYY-MM-DD HH:MM:SS', which compares correctly against these date bounds.
 */
export function buildReferralReportSql(ref: Ref, from: string, to: string): string[] {
  if (parseRef(ref) === null) throw new Error(`Unknown ref ${JSON.stringify(ref)}`);
  assertDate(from, 'from');
  assertDate(to, 'to');
  if (from >= to) throw new Error(`from (${from}) must be before to (${to})`);

  const range = `created_at >= '${from}' AND created_at < '${to}'`;
  const clicks =
    'SELECT COUNT(*) AS total, ' +
    'COALESCE(SUM(matched = 1), 0) AS matched, ' +
    'COALESCE(SUM(matched = 0), 0) AS missed, ' +
    'COALESCE(SUM(is_bot = 0), 0) AS human, ' +
    'COALESCE(SUM(is_bot = 1), 0) AS bot ' +
    `FROM referral_clicks WHERE ref = '${ref}' AND ${range};`;
  const signups = `SELECT COUNT(*) AS signups FROM users WHERE signup_ref = '${ref}' AND ${range};`;
  return [clicks, signups];
}

/** Sign-ups per human click, one decimal place, or 'n/a' when there were no human clicks. */
function conversion(signups: number, human: number): string {
  if (human === 0) return 'n/a';
  return `${((signups / human) * 100).toFixed(1)}%`;
}

/** Plain-text report, one figure per line. The conversion line is last. */
export function formatReferralReport(input: ReferralReportInput): string {
  const { ref, from, to, clicks, signups } = input;
  return [
    `Referral report for ref=${ref}, ${from} to ${to} (to is exclusive)`,
    `Clicks: ${clicks.total}`,
    `Matched: ${clicks.matched}`,
    `Missed: ${clicks.missed}`,
    `Human clicks: ${clicks.human}`,
    `Bot clicks: ${clicks.bot}`,
    `Sign-ups: ${signups}`,
    `Conversion (sign-ups ÷ human clicks, counts requests not people): ${conversion(signups, clicks.human)}`,
  ].join('\n');
}
