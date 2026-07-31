/**
 * The small conversions the page needs, kept out of the template so they can be asserted directly.
 *
 * Every timestamp is rendered in **UTC**. qits-cd stamps `Instant`s, an operator reading this table
 * is usually reading a log line beside it, and a browser-local rendering would make two people
 * looking at the same deployment disagree about when it happened. The `Z` on the long form says so
 * out loud.
 *
 * Copied from qits-spa-ci's `format.ts` and trimmed to what this screen draws — the ci-only pieces
 * (ANSI stripping, the repository-url basename) have no caller here, and carrying them across would
 * be duplication that is not even used.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** What is drawn where there is nothing to draw — one em dash, everywhere. */
export const NONE = '—';

function parse(iso: string | null | undefined): Date | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** `31 Jul 14:09` — the table's timestamp, no year, because the table is about recency. */
export function formatDayTime(iso: string | null): string {
  const date = parse(iso);
  if (!date) {
    return NONE;
  }
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** `31 Jul 2026 14:09:04Z` — the expanded row, where the exact instant is the point. */
export function formatInstant(iso: string | null): string {
  const date = parse(iso);
  if (!date) {
    return NONE;
  }
  return (
    `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * How long ago, in one unit: `45s`, `12m`, `3h`, `2d`.
 *
 * The column beside the timestamp, and the reason the table answers "is this current?" at a glance.
 * One unit rather than two on purpose — a deployment that landed nineteen hours ago is `19h`, and
 * the minutes would be noise. `now` is passed in so the cell ticks off a local clock rather than a
 * poll: a deployment nobody has touched still ages, and re-reading the service to learn that would
 * be traffic for a subtraction.
 */
export function formatAge(iso: string | null, nowMs: number): string {
  const date = parse(iso);
  if (!date) {
    return NONE;
  }
  const seconds = Math.max(0, Math.round((nowMs - date.getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

/**
 * `4m 12s`, `1h 04m`, `41s` — how long the deployment itself took.
 *
 * `to` is null for one that has not finished, in which case the caller passes the current time;
 * that is how a `STARTING` row's elapsed time grows between polls rather than only on them.
 */
export function formatDuration(from: string | null, to: string | null, nowMs?: number): string {
  const start = parse(from);
  if (!start) {
    return NONE;
  }
  const end = parse(to)?.getTime() ?? nowMs;
  if (end === undefined) {
    return NONE;
  }
  const total = Math.max(0, Math.round((end - start.getTime()) / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) {
    return `${hours}h ${pad(minutes)}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${pad(seconds)}s`;
  }
  return `${seconds}s`;
}

/**
 * The first seven characters of a sha, as git itself abbreviates. The cell carries the full sha in
 * its `title`, because seven characters is a label and the whole thing is the fact.
 */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
