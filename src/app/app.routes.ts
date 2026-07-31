import type { Routes } from '@angular/router';
import { QitsMainLayout } from '@qits/ui-components';

/**
 * One route, and it is the platform's chrome. `QitsMainLayout` sits at `''` as a *component*
 * route so it is mounted once and only its own outlet changes underneath — wrapping it around
 * each page instead would tear the sidebar down and rebuild it on every navigation.
 *
 * `children` is empty on purpose: this SPA's pages come later, and they hang here.
 */
export const routes: Routes = [{ path: '', component: QitsMainLayout, children: [] }];
