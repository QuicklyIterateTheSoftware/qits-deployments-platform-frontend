import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { QITS_SCOPE, QitsBadge, QitsButton, type QitsBadgeTone } from '@qits/ui-components';
import { CdApi } from '../api/cd-api';
import {
  isCompletedRequest,
  isPendingGate,
  isRefused,
  type CdDeploymentRequestDto,
} from '../api/dto';
import { injectScopedProject } from '../nav/scoped-project';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { formatAge, formatDayTime } from '../ui/format';
import { LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { StatusBadge } from '../ui/status-badge';
import { tickingNow } from '../ui/ticker';
import { CD_REQUEST_POLL_MS } from './poll-interval';

/**
 * How many settled requests the server sends back, restated here for the caption alone.
 *
 * Nothing on this page slices a list with it — the cap is applied in qits-deployments, before the
 * rows are on the wire — and that is exactly why the number has to be written down somewhere the
 * caption can read it. A "Completed" heading that said nothing about a cap would read as this
 * project's whole release history, which is the one thing it is not.
 */
export const COMPLETED_SHOWN = 10;

/**
 * Every release this project asked the platform for: what is still moving, and what happened last.
 *
 * **It is read per PROJECT and by nothing else.** The front page reads requests per tier, folded
 * into an application's row, and that is the right shape for "what is running in dev" and the wrong
 * one for this: a project's releases enter at whichever environment the platform designates, the
 * designation moves, and a reader asking what their project has been shipping does not know or care
 * which tier that is today. So this page makes exactly one request, `?projectId=`, and the server
 * answers with every request still moving plus the ten most recent that are not.
 *
 * **The scope comes from the address and never from a route parameter.** `QITS_SCOPE` parses
 * `/qits/deployment-requests` the same way the chrome does, which is what lets one component serve
 * the scoped route without knowing the route exists. Outside a project there is no project id to
 * ask with, so this page **makes no request at all** and says so in a sentence — a listing that is
 * empty because nobody scoped it looks exactly like a project that has never released, and the two
 * are not the same answer.
 *
 * **The split is `isCompletedRequest`, which mirrors the server's `RequestLifecycle`.** Pending is
 * complete and completed is capped, both decided over there; this page draws the two sections and
 * counts them. A client that classified rows differently would draw a "Completed" section holding
 * rows the cap never counted.
 *
 * The poll is a `setTimeout` chain armed after each answer, at {@link CD_REQUEST_POLL_MS}, and only
 * while a pending row is on screen — a settled project generates no traffic, and neither does a
 * hidden tab.
 */
@Component({
  selector: 'app-deployment-requests-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `NgTemplateOutlet` so the two sections draw one table rather than two copies of it: they are
  // the same rows split by one predicate, and a second copy would be a place for them to drift.
  imports: [Async, Empty, NgTemplateOutlet, QitsBadge, QitsButton, RouterLink, StatusBadge],
  templateUrl: './deployment-requests-page.html',
  styleUrl: './deployment-requests-page.css',
})
export class DeploymentRequestsPage {
  /** The project the address names — the header's subject, and the only thing this page reads by. */
  protected readonly scoped = injectScopedProject();

  /**
   * The scoped project's **id**, which is what the API takes. The address carries the slug and the
   * chrome resolves it against the project list, so this is `undefined` for one paint and the load
   * happens when it answers.
   */
  private readonly scopeSource = inject(QITS_SCOPE, { optional: true });

  private readonly cdApi = inject(CdApi);
  private readonly document = inject(DOCUMENT);
  private readonly pollMs = inject(CD_REQUEST_POLL_MS);

  protected readonly requests = signal<Loadable<readonly CdDeploymentRequestDto[]>>(LOADING);

  /** A poll that failed, said beside the rows rather than instead of them. */
  protected readonly pollProblem = signal('');

  protected readonly formatDayTime = formatDayTime;
  protected readonly formatAge = formatAge;
  protected readonly completedShown = COMPLETED_SHOWN;

  /** The age column ticks off a local clock; the poll is for what the server can change. */
  protected readonly now = tickingNow();

  private pollHandle: ReturnType<typeof setTimeout> | null = null;
  private polling = false;

  /** Which project this page last issued a read for, so the effect does not re-ask for the same one. */
  private loadedFor: string | null = null;

  /** The project slug the address states, or `''` outside one. */
  protected readonly projectSlug = computed(() => this.scoped.scope().project ?? '');

  /**
   * Whether the address names no project at all.
   *
   * It is asked of the SLUG and not of the resolved id, because the two absences mean different
   * things: no slug is "this page was opened outside a project", while a slug whose id has not
   * arrived yet is the one paint before the chrome's project list answers.
   */
  protected readonly scopeless = computed(() => this.projectSlug() === '');

  private readonly rows = computed<readonly CdDeploymentRequestDto[]>(() => {
    const state = this.requests();
    return state.kind === 'ready' ? state.value : [];
  });

  /** Everything the platform has not finished with — all of it, because the server caps neither. */
  protected readonly pending = computed(() =>
    this.rows().filter((request) => !isCompletedRequest(request)),
  );

  /** What happened last: the server's ten newest settled requests, in its order. */
  protected readonly completed = computed(() => this.rows().filter(isCompletedRequest));

  /** `following 2 releases`, and only while there is something to follow. */
  protected readonly following = computed(() => {
    const count = this.pending().length;
    return count === 0 ? '' : `following ${count} ${count === 1 ? 'release' : 'releases'}`;
  });

  constructor() {
    // What the address says is in scope decides what is read, and it decides it again when the
    // chrome's project list turns the slug into an id — which is the paint the first load happens on.
    effect(() => {
      const projectId = this.scopeSource?.projectId();
      if (!projectId || this.loadedFor === projectId) {
        return;
      }
      this.loadedFor = projectId;
      void this.load(projectId);
    });

    // Start or stop the poll as the pending set changes. Nothing else turns it on.
    effect(() => {
      this.pending();
      this.syncPolling();
    });

    const onVisibilityChange = () => this.onVisibilityChange();
    this.document.addEventListener('visibilitychange', onVisibilityChange);
    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisibilityChange);
      this.stopPolling();
    });
  }

  /** The one button in the header: read the project's requests again. */
  protected async reload(): Promise<void> {
    const projectId = this.scopeSource?.projectId();
    if (projectId) {
      await this.load(projectId);
    }
  }

  private async load(projectId: string): Promise<void> {
    this.requests.set(LOADING);
    this.pollProblem.set('');
    try {
      this.requests.set(ready(await this.cdApi.projectDeploymentRequests(projectId)));
    } catch (error) {
      this.requests.set(failed(error));
    }
  }

  /**
   * One poll, and it does **not** drop the rows back to a skeleton: what is on screen is still the
   * last thing the server said, and blanking it every six seconds would make a release that is
   * moving unreadable at exactly the moment somebody is watching it move.
   */
  private async poll(): Promise<void> {
    const projectId = this.scopeSource?.projectId();
    if (this.polling || !projectId) {
      return;
    }
    this.polling = true;
    try {
      this.requests.set(ready(await this.cdApi.projectDeploymentRequests(projectId)));
      this.pollProblem.set('');
    } catch (error) {
      this.pollProblem.set(describeError(error));
    } finally {
      this.polling = false;
      this.syncPolling();
    }
  }

  /** Poll only while a release is still moving, and never behind a hidden tab. */
  private shouldPoll(): boolean {
    return this.pending().length > 0 && !this.document.hidden;
  }

  /**
   * Arm the next read, once. The timer is set after an answer rather than on a schedule — see
   * {@link CD_REQUEST_POLL_MS} — so two reads can never overlap and a slow service is not handed
   * more traffic.
   */
  private syncPolling(): void {
    if (!this.shouldPoll()) {
      this.stopPolling();
      return;
    }
    this.pollHandle ??= setTimeout(() => {
      this.pollHandle = null;
      void this.poll();
    }, this.pollMs);
  }

  private stopPolling(): void {
    if (this.pollHandle !== null) {
      clearTimeout(this.pollHandle);
      this.pollHandle = null;
    }
  }

  /** A hidden tab polls nothing; coming back is worth one immediate read rather than a stale screen. */
  private onVisibilityChange(): void {
    if (this.shouldPoll()) {
      void this.poll();
    }
    this.syncPolling();
  }

  /** Where this request's own page is, inside whatever project scope the reader is in. */
  protected detailLink(request: CdDeploymentRequestDto): readonly string[] {
    return [...this.scoped.commands(), 'deployment-requests', request.id];
  }

  /**
   * The gate's word.
   *
   * Duplicated from the deployments table rather than lifted into a shared helper, which is this
   * repository's standing preference: two screens agreeing today is not a reason to make one of them
   * unable to change without the other. The wording is three lines and the argument for each is in
   * `deployment-table.ts`.
   */
  protected gateLabel(request: CdDeploymentRequestDto): string {
    if (isPendingGate(request)) {
      return 'In the gate';
    }
    return request.qualityGate === 'MET' ? 'Gate met' : 'Gate unmet';
  }

  /**
   * `success` for a version that was allowed through, `warning` for one that was not, `info` while
   * nothing has answered. A refusal is not a `danger`: nothing failed — the platform declined, on
   * purpose, and said why.
   */
  protected gateTone(request: CdDeploymentRequestDto): QitsBadgeTone {
    if (isPendingGate(request)) {
      return 'info';
    }
    return request.qualityGate === 'MET' ? 'success' : 'warning';
  }

  /**
   * What became of a request that has no deployment to show a status for.
   *
   * A refusal and a request whose deployment row an environment teardown forgot both arrive as a
   * null status, and they are not the same sentence — the gate is what tells them apart.
   */
  protected outcome(request: CdDeploymentRequestDto): string {
    if (isPendingGate(request)) {
      return 'nothing queued yet';
    }
    return isRefused(request) ? 'nothing was deployed' : 'no deployment row';
  }

  /** The sentence for a reader who opened this page outside a project. */
  protected readonly scopelessMessage =
    'Deployment requests are read per project — open this page inside one.';
}
