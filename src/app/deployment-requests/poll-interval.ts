import { InjectionToken } from '@angular/core';

/**
 * How long these two screens wait between reads while something is still moving.
 *
 * Six seconds rather than the front page's five, and the difference is the question being asked: the
 * table polls a whole tier's containers coming up, which is tens of seconds of real change, while
 * these pages watch one release cross a gate and a deployment — mostly a wait, occasionally a
 * change. A second either way is not the point; a screen that keeps re-reading a settled release
 * forever is.
 *
 * **The chain is a `setTimeout` armed after each answer, never a `setInterval`**, and that is the
 * one thing about the poll worth defending. An interval fires on a schedule the server has no say
 * in, so a read that takes seven seconds is overlapped by the next one and a service having a bad
 * moment is handed more traffic exactly when it can least take it. Waiting for the answer and then
 * arming the next timer makes the cadence "six seconds of quiet", which is what was meant.
 *
 * It is a token rather than a constant for `QITS_API_BASE`'s reason and no other: a spec needs a
 * seam. Faking timers is not that seam here — Angular's zoneless scheduler races its own
 * `setTimeout` against a `requestAnimationFrame`, so a suite that faked `setTimeout` would freeze
 * rendering and never reach a stable fixture. A spec overrides this to a couple of milliseconds and
 * waits on the real clock.
 */
export const CD_REQUEST_POLL_MS = new InjectionToken<number>('qits.deployment-request-poll-ms', {
  providedIn: 'root',
  factory: () => 6000,
});
