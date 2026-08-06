import type { Routes } from '@angular/router';
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
 * **The deployments page is the root view**, not a child called `/deployments`:
 * `/platform-deployments/` is where an operator arrives and what is deployed is what they came for.
 * Expansion is carried in query parameters (`/platform-deployments/?project=…`, and `env=` for the
 * environments no project claims) rather than in path segments, because it is view state and the
 * path is for resources — and because query parameters keep the back button meaning "collapse".
 *
 * **There is no detail route**, and that is a decision rather than an omission. A deployment row
 * already carries everything qits-platform-deployments knows about it — `commitSha`, `status`,
 * `containerName`, `detail`, `createdAt`, `finishedAt` — so the row expands in place. The service
 * has no deployment-by-id endpoint, and adding one to serve a screen we decided not to draw would
 * be building backwards.
 *
 * The `**` route sits *inside* the layout, unlike spa-home's. spa-home is mounted at the gateway
 * root, where an unrecognised first segment belongs to another application and has to be handed
 * back; `/platform-deployments/` is a segment this application owns outright, so an unknown URL
 * under it is an ordinary 404 and is drawn with the chrome around it.
 */
export const routes: Routes = [
  {
    path: '',
    component: QitsMainLayout,
    children: [
      { path: '', component: DeploymentsPage },
      { path: '**', component: NotFound },
    ],
  },
];
