// ABOUTME: Week windows (half-open, 168 hours), the UTC day partitions they touch, and
// ABOUTME: day and time labels in the owner's timezone, falling back to UTC dates.

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86400;
const WEEK_SECONDS = 7 * DAY_SECONDS;

/** The 168-hour window ending `weeksBack` weeks before `now`, as [from, to) in epoch seconds. */
export function weekWindow(now: number, weeksBack = 0): { from: number; to: number } {
  return { from: now - (weeksBack + 1) * WEEK_SECONDS, to: now - weeksBack * WEEK_SECONDS };
}

/** Every UTC day ('YYYY-MM-DD') that overlaps the half-open interval [from, to). */
export function utcDays(from: number, to: number): string[] {
  const days: string[] = [];
  for (let day = Math.floor(from / DAY_SECONDS); day * DAY_SECONDS < to; day++) {
    days.push(new Date(day * DAY_SECONDS * 1000).toISOString().slice(0, 10));
  }
  return days;
}

// Building an Intl.DateTimeFormat is slow relative to formatting, and facts label many timestamps.
const formatters = new Map<string, Intl.DateTimeFormat>();

type FormatKind = 'day' | 'date' | 'time' | 'hour';

const FORMAT_OPTIONS: Record<FormatKind, Intl.DateTimeFormatOptions> = {
  day: { weekday: 'short', month: 'short', day: 'numeric' },
  date: { year: 'numeric', month: '2-digit', day: '2-digit' },
  time: { hour: 'numeric', minute: '2-digit', hour12: true },
  hour: { hour: 'numeric', hourCycle: 'h23' },
};

function formatter(kind: FormatKind, timeZone: string): Intl.DateTimeFormat {
  const key = `${kind}|${timeZone}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone, ...FORMAT_OPTIONS[kind] });
    formatters.set(key, fmt);
  }
  return fmt;
}

// Assemble from parts so ICU's punctuation ("Sun, Nov 8") and narrow no-break spaces ("1:17 PM") never leak through.
function parts(fmt: Intl.DateTimeFormat, ts: number): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
  const out: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of fmt.formatToParts(ts * 1000)) out[part.type] = part.value;
  return out;
}

/** 'Mon Nov 2' in the owner's timezone, or the UTC date when the timezone is unknown. */
export function dayLabel(ts: number, tz: string | null): string {
  const p = parts(formatter('day', tz ?? 'UTC'), ts);
  return `${p.weekday} ${p.month} ${p.day}`;
}

/** The calendar date ('YYYY-MM-DD') in the owner's timezone, or the UTC date when the timezone is unknown. */
export function localDate(ts: number, tz: string | null): string {
  const p = parts(formatter('date', tz ?? 'UTC'), ts);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * The first whole UTC hour in [from, to) that falls on `date` ('YYYY-MM-DD') in the owner's timezone, or null when
 * none does. A moment a statement can name that day by, when nothing happened on it.
 */
export function tsOnLocalDate(date: string, tz: string | null, from: number, to: number): number | null {
  for (let ts = Math.ceil(from / HOUR_SECONDS) * HOUR_SECONDS; ts < to; ts += HOUR_SECONDS) {
    const day = localDate(ts, tz);
    if (day === date) return ts;
    // Dates only move forward, and 'YYYY-MM-DD' strings sort as dates.
    if (day > date) return null;
  }
  return null;
}

/** '5:29 PM' in the owner's timezone, or null when the timezone is unknown. */
export function timeLabel(ts: number, tz: string | null): string | null {
  if (tz === null) return null;
  const p = parts(formatter('time', tz), ts);
  return `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** The hour of the day, 0 to 23, in the owner's timezone, or null when the timezone is unknown. */
export function localHour(ts: number, tz: string | null): number | null {
  if (tz === null) return null;
  return Number(parts(formatter('hour', tz), ts).hour);
}
