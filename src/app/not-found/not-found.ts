import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { injectScopedProject } from '../nav/scoped-project';

/**
 * A URL under `/platform-deployments/` that this app does not recognise.
 *
 * It renders a small page and stops there. It deliberately does **not** copy spa-home's exit
 * behaviour of handing the URL back to the gateway: that is the landing page's job, and it is
 * correct only because spa-home is mounted at the root, where an unknown first segment is another
 * micro frontend rather than a typo. Here the segment is already ours — the gateway routed
 * `/platform-deployments/…` to qits-deployments on purpose — so there is nobody to hand it to, and
 * bouncing it back would be a loop.
 */
@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <h1>No such page here</h1>
    <p>
      This is the CD explorer. It has one screen — what is deployed, by project — and nothing else.
    </p>
    <p><a [routerLink]="scoped.commands()">Back to the deployments</a></p>
  `,
  styles: `
    h1 {
      font-size: 1.25rem;
      margin: 0 0 0.5rem;
    }
  `,
})
export class NotFound {
  /** Back to the table the reader came from — the project's, where the address named one. */
  protected readonly scoped = injectScopedProject();
}
