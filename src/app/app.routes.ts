import type { Route, Routes } from '@angular/router';
import { QitsMainLayout } from '@qits/ui-components';
import { DeploymentsPage } from './deployments/deployments-page';
import { NotFound } from './not-found/not-found';

/**
 * Two routes, both inside the platform chrome.
 *
 * `QitsMainLayout` sits at `''` as a *component* route so it is mounted once and only its own
 * outlet changes underneath — wrapping it around each page instead would tear the sidebar down and
 * rebuild it on every navigation.
 *
 * **The deployments page is the root view**, not a child called `/deployments`: the root of this
 * service's own host is where an operator arrives and what is deployed is what they came for.
 * Expansion is carried in query parameters (`?project=…`, and `env=` for the environments no
 * project claims) rather than in path segments, because it is view state and the path is for
 * resources — and because query parameters keep the back button meaning "collapse".
 *
 * **There is no detail route**, and that is a decision rather than an omission. A deployment row
 * already carries everything qits-deployments knows about it — `commitSha`, `status`,
 * `containerName`, `detail`, `createdAt`, `finishedAt` — so the row expands in place. The service
 * has no deployment-by-id endpoint, and adding one to serve a screen we decided not to draw would
 * be building backwards.
 *
 * The `**` route sits *inside* the layout. This application is served at the root of its own host,
 * so an unknown URL is an ordinary 404 and is drawn with the chrome around it — there is nobody to
 * hand it back to.
 */
const OWN: Routes = [{ path: '', component: DeploymentsPage }];

/**
 * The same page under a project slug — `/qits` beside `/`.
 *
 * A page never reads this parameter: it asks `QITS_SCOPE`, which parses the address the same way in
 * both forms, so one component serves both. Here the scope does one visible thing — it seeds the
 * expansion, so a reader arriving inside a project finds that project's row already open.
 *
 * This app is project scoped and not repository scoped: a deployment is of an application, and the
 * table is one row per application under the environment that runs it.
 */
const SCOPED: Route = { path: ':project', children: OWN };

export const routes: Routes = [
  {
    path: '',
    component: QitsMainLayout,
    children: [...OWN, SCOPED, { path: '**', component: NotFound }],
  },
];
