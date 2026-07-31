import { HttpErrorResponse } from '@angular/common/http';

/**
 * What one node of the page — one project, one environment — knows about the thing it is showing.
 *
 * `idle` is a node that has never been expanded, and it is a *state*, not an absence: the whole
 * point of Decision 3 is that a collapsed node has made no request, so "no data" and "not asked"
 * must not be the same value. Every node holds its own, which is what lets one environment's failed
 * deployment fetch collapse to an inline retry on that row while the rest of the page stays
 * standing.
 */
export type Loadable<T> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: T }
  | { readonly kind: 'error'; readonly status: number; readonly message: string };

/** Never expanded, never requested. */
export const IDLE: Loadable<never> = { kind: 'idle' };

/** Requested, nothing back yet. */
export const LOADING: Loadable<never> = { kind: 'loading' };

/** Arrived. */
export function ready<T>(value: T): Loadable<T> {
  return { kind: 'ready', value };
}

/** Did not arrive, and why — the status is kept because a 404 is a different screen from a 503. */
export function failed(error: unknown): Loadable<never> {
  return { kind: 'error', status: statusOf(error), message: describeError(error) };
}

/**
 * Two loadables read as one, because the thing they build is one thing.
 *
 * An expanded environment costs two requests — its applications and its deployments — and the table
 * cannot be drawn from either alone: the applications are the rows and the deployments are what
 * fills them. So a failure of either is one failure with one retry, rather than two error lines
 * beside half a table. The error wins over the still-loading sibling, since there is already
 * something true to say.
 */
export function both<A, B>(a: Loadable<A>, b: Loadable<B>): Loadable<readonly [A, B]> {
  if (a.kind === 'error') {
    return a;
  }
  if (b.kind === 'error') {
    return b;
  }
  if (a.kind === 'loading' || b.kind === 'loading') {
    return LOADING;
  }
  if (a.kind === 'ready' && b.kind === 'ready') {
    return ready([a.value, b.value] as const);
  }
  return IDLE;
}

/** The HTTP status, or 0 for anything that never reached a server. */
export function statusOf(error: unknown): number {
  return error instanceof HttpErrorResponse ? error.status : 0;
}

/**
 * The shortest true sentence about a failure. The services answer errors in a `{"message": …}`
 * envelope, so that message is preferred when there is one; a status of 0 means the request never
 * got an answer at all, which reads as "unreachable" rather than as an HTTP code that does not
 * exist.
 */
export function describeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'the service is unreachable';
    }
    const message = serverMessage(error.error);
    return message ? `${error.status} ${message}` : `${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** The `message` field of an error body, when the body is one. */
function serverMessage(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as { message: unknown }).message;
    return typeof message === 'string' ? message : null;
  }
  return null;
}
