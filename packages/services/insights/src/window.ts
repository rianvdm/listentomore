// ABOUTME: Week windows (half-open, 168 hours), the UTC day partitions they touch, and
// ABOUTME: day and time labels in the owner's timezone, falling back to UTC dates.

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

const FORMAT_OPTIONS: Record<'day' | 'time' | 'hour', Intl.DateTimeFormatOptions> = {
  day: { weekday: 'short', month: 'short', day: 'numeric' },
  time: { hour: 'numeric', minute: '2-digit', hour12: true },
  hour: { hour: 'numeric', hourCycle: 'h23' },
};

function formatter(kind: 'day' | 'time' | 'hour', timeZone: string): Intl.DateTimeFormat {
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
