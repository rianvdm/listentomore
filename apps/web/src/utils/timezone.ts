// ABOUTME: Keeps users.timezone in step with the signed-in user's cf.timezone on page loads.
// ABOUTME: Validates the zone with Intl first and writes off the response path; a failure never fails the page.

import type { Context } from 'hono';
import { createServiceDefer } from '@listentomore/shared';
import type { Database, User } from '@listentomore/db';
import { getWaitUntil } from './wait-until';

/**
 * True when Intl accepts the value as a time zone. Insights date labels throw
 * RangeError on an unknown zone, so only validated zones are ever stored.
 */
export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Store the request's cf.timezone on the signed-in user when it is valid and
 * differs from the stored value. The UPDATE runs through waitUntil (or as an
 * unawaited, logged promise without an ExecutionContext) and never blocks or
 * fails the request. Failures log the error only, never the zone or user id.
 */
export function syncUserTimezone(c: Context, user: User | null): void {
  if (!user) return;

  const timezone = (c.req.raw.cf as { timezone?: unknown } | undefined)?.timezone;
  if (typeof timezone !== 'string' || timezone === user.timezone || !isValidTimezone(timezone)) return;

  const db = c.get('db') as Database;
  createServiceDefer('[Timezone]', getWaitUntil(c))(
    db.updateUser(user.id, { timezone }),
    'timezone update'
  );
}
