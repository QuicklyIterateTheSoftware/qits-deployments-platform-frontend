import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { QitsButton } from '@qits/ui-components';
import { CdApi } from '../api/cd-api';
import { injectScopedProject } from '../nav/scoped-project';
import { Async } from '../ui/async';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';

/**
 * The address a link from a RELEASE lands on: `/…/deployment-requests/by-release/<repoId>/<version>`.
 *
 * **It exists because the linker does not know the id.** qits-projects holds a release request — a
 * repository and a version — and wants to send a reader to what this platform did with it, but the
 * deployment request's id is minted here, on the deploy worker, after the release. Publishing that
 * id back to qits-projects would be a second coordinate system and a write across a boundary that
 * carries none; resolving it here costs one query and no contract.
 *
 * **The redirect is `replaceUrl`**, so pressing back returns to whatever linked here rather than to
 * this page, which would resolve again and bounce the reader forward. That is the whole reason this
 * is a component and not a plain route redirect: the answer needs a request.
 *
 * **A miss is a sentence, not a 404.** Nothing existing here is the ordinary answer for a library or
 * an SPA — those release a version that deploys nothing at all — and it is also what a release looks
 * like in the seconds before it reaches this service. The two are told apart by waiting, so the page
 * offers a retry rather than a dead end.
 *
 * Both segments are `encodeURIComponent`-safe in both directions: the router decodes what it matched,
 * and `CdApi` encodes them again as query parameters.
 */
@Component({
  selector: 'app-deployment-request-resolver',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, QitsButton],
  template: `
    <app-async
      [state]="state()"
      loadingLabel="Looking for the deployment request"
      errorLabel="Could not look up the deployment request"
      (retry)="resolve()"
    />

    @if (state().kind === 'ready' && missing()) {
      <p class="miss">
        No deployment request exists for {{ repoId() }}&#64;{{ version() }} — the release may deploy
        nothing (a library or SPA), or it has not reached this service yet.
      </p>
      <qits-button variant="secondary" size="sm" (pressed)="resolve()">Look again</qits-button>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .miss {
      margin: 0.5rem 0;
      color: #6b7280;
    }
  `,
})
export class DeploymentRequestResolver {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cdApi = inject(CdApi);
  private readonly scoped = injectScopedProject();

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: convertToParamMap({}),
  });

  protected readonly state = signal<Loadable<number>>(LOADING);

  protected readonly repoId = computed(() => this.params().get('repoId') ?? '');
  protected readonly version = computed(() => this.params().get('version') ?? '');

  /** Ready, and nothing matched — the sentence rather than the redirect. */
  protected readonly missing = computed(() => {
    const state = this.state();
    return state.kind === 'ready' && state.value === 0;
  });

  private resolvedFor = '';

  constructor() {
    effect(() => {
      const key = `${this.repoId()}@${this.version()}`;
      if (!this.repoId() || !this.version() || this.resolvedFor === key) {
        return;
      }
      this.resolvedFor = key;
      void this.resolve();
    });
  }

  /**
   * One query, and the first match wins.
   *
   * More than one is an ordinary answer — a version redeployed by hand writes a second request — and
   * the server sends them newest first, so the first is the one a reader following a link means.
   */
  protected async resolve(): Promise<void> {
    this.state.set(LOADING);
    try {
      const matches = await this.cdApi.deploymentRequestsByRelease(this.repoId(), this.version());
      this.state.set(ready(matches.length));
      if (matches.length > 0) {
        void this.router.navigate(
          [...this.scoped.commands(), 'deployment-requests', matches[0].id],
          { replaceUrl: true },
        );
      }
    } catch (error) {
      // Named rather than swallowed: a 400 here means the link was built with half a pair, which is
      // a bug in whoever built it and is worth being able to read.
      this.state.set(failed(error));
    }
  }
}
