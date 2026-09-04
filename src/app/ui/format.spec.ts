import { NONE, formatAge, formatDayTime, formatDuration, formatInstant, shortSha } from './format';

/**
 * Small pure functions, asserted directly, because the alternative is asserting them through a
 * rendered table and discovering a timezone bug as a string mismatch three components away.
 *
 * The UTC assertions are the point: these run under whatever `TZ` the machine has, and every one
 * of them would drift if the formatting were local.
 */
describe('format', () => {
  it('renders a table timestamp in UTC, without the year', () => {
    expect(formatDayTime('2026-07-31T14:09:04Z')).toBe('31 Jul 14:09');
  });

  it('renders the exact instant with its Z, so two readers agree on when', () => {
    expect(formatInstant('2026-07-31T14:09:04Z')).toBe('31 Jul 2026 14:09:04Z');
  });

  it('ages a deployment in one unit', () => {
    const now = Date.parse('2026-07-31T14:09:04Z');
    expect(formatAge('2026-07-31T14:08:19Z', now)).toBe('45s');
    expect(formatAge('2026-07-31T13:57:04Z', now)).toBe('12m');
    expect(formatAge('2026-07-31T11:09:04Z', now)).toBe('3h');
    expect(formatAge('2026-07-29T09:12:00Z', now)).toBe('2d');
  });

  it('never ages into the future, whatever the clocks disagree about', () => {
    const now = Date.parse('2026-07-31T14:09:04Z');
    expect(formatAge('2026-07-31T14:10:00Z', now)).toBe('0s');
  });

  it('measures how long a deployment took, and keeps counting while it has not', () => {
    expect(formatDuration('2026-07-31T14:09:04Z', '2026-07-31T14:09:45Z')).toBe('41s');
    expect(formatDuration('2026-07-31T14:02:11Z', '2026-07-31T14:06:23Z')).toBe('4m 12s');
    expect(formatDuration('2026-07-31T13:02:11Z', '2026-07-31T14:06:23Z')).toBe('1h 04m');
    expect(formatDuration('2026-07-31T14:09:04Z', null, Date.parse('2026-07-31T14:09:24Z'))).toBe(
      '20s',
    );
  });

  it('draws one em dash wherever there is nothing to draw', () => {
    expect(formatDayTime(null)).toBe(NONE);
    expect(formatInstant(null)).toBe(NONE);
    expect(formatAge(null, Date.now())).toBe(NONE);
    expect(formatDuration(null, null)).toBe(NONE);
    // A deployment that has not finished and no local clock to measure against says nothing.
    expect(formatDuration('2026-07-31T14:09:04Z', null)).toBe(NONE);
  });

  it('survives a timestamp the service should never have sent', () => {
    expect(formatDayTime('not a date')).toBe(NONE);
  });

  it('abbreviates a sha the way git does', () => {
    expect(shortSha('9f2c1ab3d4e5f6a7')).toBe('9f2c1ab');
  });

  it('draws no sha at all where a deployment records none', () => {
    // A real answer since a deployment became a version: the spec read 404s on a repository with no
    // deployments.yml, which says nothing about where the released tag points. The row keeps its
    // version and has no commit behind it.
    expect(shortSha(null)).toBe(NONE);
  });
});
