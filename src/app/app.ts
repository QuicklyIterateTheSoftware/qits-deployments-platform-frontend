import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * The shell, and deliberately nothing else. The chrome this app is seen through — the sidebar,
 * the top bar, the links out to the platform's other SPAs — is `QitsMainLayout` behind the `''`
 * route (see app.routes.ts), so it survives navigation rather than being rebuilt here.
 *
 * That leaves the outlet as the only thing this component owns, which is the point:
 * `/platform-deployments/` is this app's base href, not one of its routes, and nothing above the
 * router should know it.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {}
