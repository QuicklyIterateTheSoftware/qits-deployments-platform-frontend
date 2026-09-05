import type { Route, Routes } from '@angular/router';
import { QitsMainLayout } from '@qits/ui-components';
import { DeploymentRequestPage } from './deployment-requests/deployment-request-page';
import { DeploymentRequestResolver } from './deployment-requests/deployment-request-resolver';
import { DeploymentRequestsPage } from './deployment-requests/deployment-requests-page';
import { DeploymentsPage } from './deployments/deployments-page';
import { NotFound } from './not-found/not-found';

/**
 * Four routes, all inside the platform chrome.
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
 * **A deployment request IS a resource, and that is why three of these routes exist.** The table
 * shows what ran; a request is what was *asked for*, and a release the gate refused has no row in
 * that table at all. So the requests get addresses of their own:
 *
 * - `deployment-requests` — one project's releases, pending and settled;
 * - `deployment-requests/by-release/:repoId/:version` — the address a link from a release lands on,
 *   which resolves to the one below and replaces itself;
 * - `deployment-requests/:requestId` — one request, end to end.
 *
 * **`by-release` is declared before `:requestId` and the order is load-bearing.** Angular matches
 * routes in declaration order, so a parameter segment listed first would swallow the literal and
 * every release link would ask for a request whose id is the word `by-release`.
 *
 * **A deployment still has no detail route**, and that is unchanged: a deployment row already
 * carries everything qits-deployments knows about it, so the row expands in place and the service
 * has no deployment-by-id endpoint to build a page on. The request detail page carries its
 * deployment inline for exactly that reason.
 *
 * The `**` route sits *inside* the layout. This application is served at the root of its own host,
 * so an unknown URL is an ordinary 404 and is drawn with the chrome around it — there is nobody to
 * hand it back to.
 */
const OWN: Routes = [
  { path: '', component: DeploymentsPage },
  { path: 'deployment-requests', component: DeploymentRequestsPage },
  {
    path: 'deployment-requests/by-release/:repoId/:version',
    component: DeploymentRequestResolver,
  },
  { path: 'deployment-requests/:requestId', component: DeploymentRequestPage },
];

/**
 * The same pages under a project slug — `/qits` beside `/`.
 *
 * A page never reads this parameter: it asks `QITS_SCOPE`, which parses the address the same way in
 * both forms, so one component serves both. On the deployments table the scope seeds the expansion;
 * on the requests page it is the whole of what is read, because a deployment request is asked for
 * by project and by nothing else — which is why that page, outside a project, makes no request at
 * all and says so.
 *
 * The one parameter any page here reads is `:requestId`, and it is not a scope: it names the
 * resource the detail page is about.
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
