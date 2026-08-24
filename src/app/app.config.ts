import { provideBrowserGlobalErrorListeners, type ApplicationConfig } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideQitsNavigation, provideQitsProjects, provideQitsScope } from '@qits/ui-components';

import { routes } from './app.routes';

/**
 * Six providers, in the order every sibling repeats.
 *
 * - `provideBrowserGlobalErrorListeners` funnels genuinely-global errors and unhandled rejections
 *   into Angular's `ErrorHandler`.
 * - `provideRouter` carries the page's expansion in its query parameters, which is what makes one
 *   project's deployments bookmarkable.
 * - `withFetch` is not a preference. The default XHR backend is invisible to OTLP fetch
 *   instrumentation, so choosing it would quietly forfeit client spans the moment this deployment
 *   grows a telemetry relay. Every call this app makes is a same-origin path on this service's own
 *   host, which is what lets the browser's session cookie reach `/projects/api/…` with no machine
 *   token and no CORS — the edge path-routes every application's segment on every vhost.
 * - `provideQitsNavigation` gives `QitsMainLayout` its left navigation, by asking the edge for
 *   `/main-navigation` once at startup. The list is the edge's answer now — derived from the
 *   deployments it actually serves — not a list compiled into @qits/ui-components; without this
 *   provider the chrome renders no links at all. It needs the `provideHttpClient` above.
 * - `provideQitsProjects` fills the chrome's project picker from one `GET /projects/api/projects`,
 *   and installs the repositories of whatever project is in scope alongside it.
 * - `provideQitsScope('project')` says how deep this application's own addresses go. This page is
 *   one table of every environment's deployments, which a project expands rather than divides, so
 *   the deepest address it serves is `/<projectSlug>/`. The scope seeds the page's expansion: a
 *   reader who arrives inside a project finds that project already open.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideQitsNavigation(),
    provideQitsProjects(),
    provideQitsScope('project'),
  ],
};
