import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { QitsAppLinks, QitsBadge, type QitsBadgeTone } from '@qits/ui-components';
import {
  isPendingGate,
  isRefused,
  isStopped,
  type CdApplicationDto,
  type CdDeploymentDto,
  type CdDeploymentRequestDto,
} from '../api/dto';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import {
  NONE,
  formatAge,
  formatDayTime,
  formatDuration,
  formatInstant,
  shortSha,
} from '../ui/format';
import { IDLE, both, type Loadable } from '../ui/loadable';
import { StatusBadge } from '../ui/status-badge';
import { tickingNow } from '../ui/ticker';

/**
 * One environment as this page holds it: the three lists an expansion fetches, each with its own
 * state so a retry knows what to re-ask for.
 *
 * `applications` is the tier's catalogue **plus the platform services**, which the page merges in
 * from the flat listing for the one environment they are deployed into; nothing below this line can
 * tell the two apart except by the `target` on the row, which is exactly how much difference there
 * is left.
 *
 * `requests` is the third list and the odd one out: the table is drawn without it. It is what a
 * release *asked* for, and it can be missing while the table is still entirely true — so it is not
 * folded into the state the table gates on, and a failed request read costs a sentence rather than
 * the whole table.
 */
export interface EnvironmentNode {
  readonly applications: Loadable<readonly CdApplicationDto[]>;
  readonly deployments: Loadable<readonly CdDeploymentDto[]>;
  readonly requests: Loadable<readonly CdDeploymentRequestDto[]>;
}

/** Anything this table orders by age: a deployment row, or the request that asked for one. */
interface Created {
  readonly createdAt: string;
}

/**
 * When a row was created, in milliseconds, or `null` for a row whose stamp is not a time.
 *
 * `createdAt` and never `finishedAt`: the question is which attempt is the LATEST, and an attempt
 * that is still running has no finish at all. A row the server sent with an unparseable stamp
 * answers `null` and is ordered by nothing rather than by `NaN`. The same reasoning holds for a
 * request, whose `gateSettledAt` is likewise the end of it and null while it is still open.
 */
function createdMillis(row: Created): number | null {
  const parsed = Date.parse(row.createdAt);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * One application's rows, newest first — **the table's definition of "current", said out loud
 * instead of inherited from the order a list happened to arrive in.**
 *
 * It used to be inherited. `current` was the first row of the bucket and the bucket was filled in
 * arrival order, so the row an operator reads as the application's state was correct exactly as
 * long as every list feeding this table was sorted newest-first end to end. That held for one
 * listing and stopped being a property anybody could check the moment the page began merging rows
 * from more than one read — and it fails silently, in the one direction that matters: a stale
 * `FAILED` or `IMAGE_MISSING` attempt shown as the current state of an application that is in fact
 * `ACTIVE`, which is an outage reported where there is none.
 *
 * **It is generic over the two lists because they had the same assumption in them.** Deployments
 * were fixed first, since that is the bug an operator saw; the deployment *requests* were still
 * read first-is-newest out of a second listing, so an out-of-order request bucket would draw an
 * already-deployed version as still outstanding — the same defect one field over, and on the one
 * cell that exists to say what has NOT shipped yet.
 *
 * **The comparison is the timestamp, and ties keep the server's order.** `Array.prototype.sort` is
 * stable, so two rows created in the same tick stay in the order the API sent them — which is `seq
 * desc`, the monotonic tiebreak the server has and the wire shape does not carry. That is why the
 * comparator answers `0` rather than reaching for the id: an arbitrary tiebreak would *replace* a
 * real ordering with a coin flip.
 *
 * Status is deliberately not consulted. The newest row is the current state whatever it says — a
 * deployment that is failing right now must read `Failed`, and a rule that preferred the newest
 * `ACTIVE` row would hide exactly the outage this page exists to show. A refused request is the
 * same: it is the newest thing asked for, and demoting it would hide the refusal.
 */
function newestFirst<T extends Created>(bucket: T[]): T[] {
  return bucket.sort((left, right) => {
    const created = createdMillis(left);
    const other = createdMillis(right);
    if (created === null || other === null || created === other) {
      return 0;
    }
    return other - created;
  });
}

/** An environment nobody has expanded: no request made, and that is a state rather than an absence. */
export const UNVISITED: EnvironmentNode = {
  applications: IDLE,
  deployments: IDLE,
  requests: IDLE,
};

/**
 * What an operator asked for on one row.
 *
 * Three words rather than a replica count, because that is what the buttons mean: `stop` and
 * `start` are the two ends of the scale the service accepts, and `restart` is a different verb
 * altogether — it changes nothing about how many run.
 */
export type OperationKind = 'restart' | 'stop' | 'start';

export interface ApplicationOperation {
  readonly applicationId: string;
  readonly applicationName: string;
  readonly kind: OperationKind;
}

/** One application's line in the table, and the history hanging behind it. */
interface Row {
  /** The application id, or the deployment's own when the environment no longer tracks it. */
  readonly key: string;
  readonly name: string;
  /** Null for a row the applications list does not explain — see `rows()`. */
  readonly repoId: string | null;
  /**
   * Whether this is a platform service rather than one of the tier's own.
   *
   * A tag on the row and nothing more. It used to be a section of its own, back when a platform
   * service belonged to no environment and could not be listed under one; it belongs to this one
   * now, and the only thing left worth saying is that it is not linked into it — which is why a
   * release of it reaches every tier at once.
   */
  readonly platform: boolean;
  /** The newest deployment for this application, which is what "current" means here. */
  readonly current: CdDeploymentDto | null;
  /** Everything older, newest first. Mostly `DECOMMISSIONED`, and not drawn until asked for. */
  readonly history: readonly CdDeploymentDto[];
  /**
   * Whether there is a running service to act on at all.
   *
   * It is `containerName` on the current row and nothing cleverer: under swarm that string IS the
   * service's name, and it is exactly what qits-deployments resolves an operation against. A
   * deployment that never got that far — `IMAGE_MISSING` is the everyday shape — has no service
   * anywhere, and the server answers 409. Drawing a button for it would be offering an action that
   * cannot work.
   */
  readonly actionable: boolean;
  /** Whether the workload is deliberately stopped, which decides Start against Restart/Stop. */
  readonly stopped: boolean;
  /** Every version asked for here, newest first — whatever the gate then said. */
  readonly requests: readonly CdDeploymentRequestDto[];
  /**
   * The newest request that did **not** produce the deployment on this row, or null.
   *
   * This is the cell that makes the lifecycle visible at a glance: a version was asked for and what
   * is running is not it. Today it is only ever a refusal or a request still in the gate, because
   * the placeholder queues a deployment in the same transaction — and that is precisely why it is
   * drawn now rather than when the first real gate makes it common.
   */
  readonly outstanding: CdDeploymentRequestDto | null;
}

/**
 * The current deployments of one environment: one row per application, and what is deployed there
 * right now.
 *
 * **The rows come from the environment's applications, not from the deployment list.** That is the
 * load-bearing choice: an application that has never been deployed has no deployment row to be
 * derived from, so deriving the table from deployments would silently drop exactly the application
 * an operator is looking for — the one that should be running and is not. It gets a row reading
 * *never deployed* instead.
 *
 * **"Current" is the NEWEST row per `applicationId`, by its own timestamp** — one client-side pass
 * over the deployments, no extra request, and `CdDeploymentDto` carries `applicationName` so
 * nothing has to be looked up. It used to be "the first row per `applicationId`", which is the same
 * answer only while every list feeding this table arrives newest-first; `newestFirst` says why that
 * stopped being something a reader could verify, and what a wrong answer here looks like on screen.
 * Everything behind that newest row is history: a redeploy decommissions its predecessor, and a
 * superseded failed attempt is the same application's past rather than its state, so it stays
 * behind the row's own expansion rather than doubling the table's length by default.
 *
 * **The version is the coordinate and the sha is the commit behind it.** A deployment is created
 * from `qits/<app>:<version>` since a release became the trigger, so the CalVer stamp is what
 * identifies the row and the sha is what the tag resolved to — worth linking to a run, and worth
 * nothing as an identity. Legacy rows carry the sha and no version; both cells are drawn per-row.
 *
 * **Deployment requests are folded into the rows by application name**, not shown apart. A request
 * is what a `SoftwareRelease` produced and the deployment is what the request produced in turn, so
 * they are one lifecycle on one line — and the request is the only place a release that shipped
 * *nothing* can be seen at all.
 *
 * The expansion is local state and deliberately not in the URL. The query parameters carry the two
 * levels that cost a request (Decision 4); a third parameter for something free would be URL noise,
 * and it dies with the node, which is the honest lifetime — a collapsed environment has no rows.
 */
@Component({
  selector: 'app-deployment-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, QitsBadge, StatusBadge],
  template: `
    <app-async
      [state]="state()"
      loadingLabel="Loading deployments"
      errorLabel="Could not load deployments"
      (retry)="reload.emit()"
    />

    @if (state().kind === 'ready') {
      @if (requestsProblem(); as problem) {
        <p class="requests-problem" role="status">
          ⚠ Deployment requests unavailable — {{ problem }}. The table below is what ran; a release
          the gate refused would not be in it.
        </p>
      }
      @if (rows().length === 0) {
        <app-empty message="This environment tracks no applications." />
      } @else {
        <table class="deployments">
          <thead>
            <tr>
              <th scope="col">Application</th>
              <th scope="col">Repository</th>
              <th scope="col">Version</th>
              <th scope="col">Status</th>
              <th scope="col">Commit</th>
              <th scope="col">Last deployment</th>
              <th scope="col">Container</th>
              <th scope="col">Operations</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.key) {
              <tr>
                <th scope="row" class="app">
                  @if (expandable(row)) {
                    <button
                      type="button"
                      class="twist"
                      [attr.aria-expanded]="isOpen(row.key)"
                      (click)="toggle(row.key)"
                    >
                      <span class="chevron" aria-hidden="true">{{
                        isOpen(row.key) ? '▾' : '▸'
                      }}</span>
                      <span>{{ row.name }}</span>
                    </button>
                  } @else {
                    <span class="plain">{{ row.name }}</span>
                  }
                  <!--
                    The whole of what used to be a section: a platform service runs in this
                    environment like everything else and is linked into none of them, which is why
                    one release of it reaches every tier at once.
                  -->
                  @if (row.platform) {
                    <span
                      class="tier"
                      title="A platform service: deployed into this environment, linked into none"
                      >platform</span
                    >
                  }
                </th>
                <td>
                  @if (row.repoId) {
                    {{ row.repoId }}
                  } @else {
                    <span class="untracked" title="No application of this id is tracked here now">
                      no longer tracked
                    </span>
                  }
                </td>
                <td class="version">
                  @if (row.current?.version; as version) {
                    <code class="calver">{{ version }}</code>
                  } @else {
                    <span class="unversioned" title="Deployed before a release named the image tag">
                      {{ none }}
                    </span>
                  }
                  <!--
                    A version was asked for here and what is running is not it. The request is the
                    only record of that, because a refused one queued no deployment at all.
                  -->
                  @if (row.outstanding; as request) {
                    <span class="outstanding" [title]="requestTitle(request)">
                      → {{ request.version }} · {{ gateWord(request) }}
                    </span>
                  }
                </td>
                <td>
                  @if (row.current; as deployment) {
                    <app-status-badge [status]="deployment.status" />
                  } @else {
                    <span class="never">never deployed</span>
                  }
                </td>
                <td class="commit">
                  @if (row.current; as deployment) {
                    <!--
                      A plain href, never a routerLink: qits-ci is a different application on a
                      host of its own, and routing to it in-app would hand the URL to this SPA's
                      router, which owns nothing outside this host. QitsAppLinks turns the
                      platform's own navigation into that address — and a row with no run, or a
                      platform that names no ci host, draws the sha as text instead of as a link
                      to nowhere.
                    -->
                    @if (deployment.runId && runHref(deployment.runId); as href) {
                      <a
                        [href]="href"
                        [title]="deployment.commitSha + ' — built by ci run ' + deployment.runId"
                      >
                        {{ shortSha(deployment.commitSha) }}
                      </a>
                    } @else {
                      <code [title]="deployment.commitSha">{{
                        shortSha(deployment.commitSha)
                      }}</code>
                    }
                  } @else {
                    {{ none }}
                  }
                </td>
                <td class="when">
                  @if (row.current; as deployment) {
                    {{ formatDayTime(deployment.createdAt) }}
                    <span class="age">{{ formatAge(deployment.createdAt, now()) }}</span>
                  } @else {
                    {{ none }}
                  }
                </td>
                <td class="container">
                  @if (row.current?.containerName; as containerName) {
                    <code>{{ containerName }}</code>
                  } @else {
                    {{ none }}
                  }
                </td>
                <!--
                  The operator's two levers, and they are drawn only where they can work. A row
                  whose deployment never reached the orchestrator has no service to act on, so it
                  gets a sentence rather than buttons that answer 409.
                -->
                <td class="ops">
                  @if (!row.actionable) {
                    <span class="never">nothing running</span>
                  } @else if (busy().has(row.key)) {
                    <span class="working" role="status">queued…</span>
                  } @else if (confirming() === row.key) {
                    <!--
                      Stopping is the one action here that takes an application off the platform, so
                      it is asked twice. Inline rather than a dialog: this table is a list of rows an
                      operator scans, and the confirmation has to name the row it is about.
                    -->
                    <span class="confirm">Stop {{ row.name }}?</span>
                    <button type="button" class="op danger" (click)="operateNow(row, 'stop')">
                      Yes, stop it
                    </button>
                    <button type="button" class="op" (click)="cancelStop()">Cancel</button>
                  } @else if (row.stopped) {
                    <button
                      type="button"
                      class="op"
                      title="Scale this application back to one task"
                      (click)="operateNow(row, 'start')"
                    >
                      Start
                    </button>
                  } @else {
                    <button
                      type="button"
                      class="op"
                      title="Replace the tasks in place — same image, same deployment"
                      (click)="operateNow(row, 'restart')"
                    >
                      Restart
                    </button>
                    <button
                      type="button"
                      class="op"
                      title="Scale this application to zero tasks"
                      (click)="askToStop(row)"
                    >
                      Stop
                    </button>
                  }
                </td>
              </tr>
              @if (isOpen(row.key)) {
                <tr class="expanded">
                  <td colspan="8">
                    @if (row.current; as deployment) {
                      <p class="times">
                        Started {{ formatInstant(deployment.createdAt) }} · Finished
                        {{ formatInstant(deployment.finishedAt) }} · Took
                        {{ formatDuration(deployment.createdAt, deployment.finishedAt, now()) }}
                      </p>
                      @if (deployment.detail) {
                        <pre class="detail">{{ deployment.detail }}</pre>
                      }
                    }
                    @if (row.requests.length > 0) {
                      <p class="requests-head">
                        {{ row.requests.length }}
                        {{ row.requests.length === 1 ? 'release asked' : 'releases asked' }} for
                        here
                      </p>
                      <ul class="requests">
                        @for (request of row.requests; track request.id) {
                          <li>
                            <qits-badge [label]="gateLabel(request)" [tone]="gateTone(request)" />
                            <code class="calver">{{ request.version }}</code>
                            <span class="when">{{ formatDayTime(request.createdAt) }}</span>
                            <span class="outcome">{{ outcome(request) }}</span>
                            @if (request.gateDetail) {
                              <span class="gate-detail">{{ request.gateDetail }}</span>
                            }
                          </li>
                        }
                      </ul>
                    }
                    @if (row.history.length > 0) {
                      <p class="history-head">
                        {{ row.history.length }} earlier
                        {{ row.history.length === 1 ? 'deployment' : 'deployments' }}
                      </p>
                      <ul class="history">
                        @for (deployment of row.history; track deployment.id) {
                          <li>
                            <app-status-badge [status]="deployment.status" />
                            @if (deployment.version) {
                              <code class="calver">{{ deployment.version }}</code>
                            }
                            @if (deployment.runId && runHref(deployment.runId); as href) {
                              <a [href]="href" [title]="deployment.commitSha">{{
                                shortSha(deployment.commitSha)
                              }}</a>
                            } @else {
                              <code [title]="deployment.commitSha">{{
                                shortSha(deployment.commitSha)
                              }}</code>
                            }
                            <span class="when">{{ formatDayTime(deployment.createdAt) }}</span>
                            @if (deployment.containerName) {
                              <code class="container">{{ deployment.containerName }}</code>
                            }
                          </li>
                        }
                      </ul>
                    }
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .deployments {
      width: 100%;
      border-collapse: collapse;
      margin: 0.35rem 0 0.75rem;
      font-size: 0.92rem;
    }
    th,
    td {
      text-align: left;
      font-weight: 400;
      padding: 0.25rem 0.5rem;
      vertical-align: baseline;
    }
    thead th {
      color: #6b7280;
      font-size: 0.78rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border-bottom: 1px solid #e5e7eb;
    }
    tbody tr:not(.expanded) + tr:not(.expanded) th,
    tbody tr:not(.expanded) + tr:not(.expanded) td {
      border-top: 1px solid #f3f4f6;
    }
    /* Inline, so the platform tag sits beside the name rather than under it. */
    .twist {
      display: inline-flex;
      align-items: baseline;
      gap: 0.4rem;
      background: none;
      border: 0;
      padding: 0;
      margin: 0;
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    .twist:focus-visible {
      outline: 2px solid #4f46e5;
      outline-offset: 1px;
    }
    .chevron {
      width: 0.9rem;
      color: #6b7280;
    }
    .plain {
      padding-left: 1.3rem;
    }
    /* The per-row hint that replaced a section: quiet, and never a heading. */
    .tier {
      font-size: 0.68rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #4b5563;
      background: #f3f4f6;
      border-radius: 0.25rem;
      padding: 0 0.3rem;
    }
    .never,
    .untracked,
    .unversioned {
      color: #6b7280;
      font-style: italic;
    }
    /* The coordinate a deployment is identified by now, so it reads as one and not as a note. */
    .calver {
      font-weight: 600;
      color: #111827;
    }
    .outstanding {
      display: block;
      color: #92400e;
      font-size: 0.8rem;
      white-space: nowrap;
    }
    .when,
    .age {
      color: #6b7280;
      white-space: nowrap;
    }
    .age {
      margin-left: 0.4rem;
    }
    .commit a,
    .history a {
      color: #4338ca;
    }
    .requests-problem {
      margin: 0.35rem 0 0;
      color: #92400e;
      font-size: 0.85rem;
    }
    .expanded td {
      padding: 0.35rem 0.5rem 0.75rem 1.8rem;
      background: #f9fafb;
    }
    .times {
      margin: 0 0 0.35rem;
      color: #4b5563;
    }
    .detail {
      margin: 0 0 0.5rem;
      padding: 0.5rem 0.6rem;
      background: #111827;
      color: #e5e7eb;
      border-radius: 0.25rem;
      overflow-x: auto;
      white-space: pre-wrap;
      font-size: 0.85rem;
    }
    .history-head,
    .requests-head {
      margin: 0 0 0.2rem;
      color: #6b7280;
      font-size: 0.85rem;
    }
    .requests-head {
      margin-top: 0.5rem;
    }
    .history,
    .requests {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .history li,
    .requests li {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      padding: 0.1rem 0;
      flex-wrap: wrap;
    }
    .outcome,
    .gate-detail {
      color: #6b7280;
      font-size: 0.85rem;
    }
    .ops {
      white-space: nowrap;
    }
    .op {
      font: inherit;
      font-size: 0.85rem;
      padding: 0.1rem 0.45rem;
      margin-right: 0.3rem;
      color: #374151;
      background: #fff;
      border: 1px solid #d1d5db;
      border-radius: 0.25rem;
      cursor: pointer;
    }
    .op:hover {
      background: #f3f4f6;
    }
    .op:focus-visible {
      outline: 2px solid #4f46e5;
      outline-offset: 1px;
    }
    .op.danger {
      color: #b91c1c;
      border-color: #fca5a5;
    }
    .confirm {
      margin-right: 0.4rem;
      color: #b91c1c;
    }
    .working {
      color: #6b7280;
      font-style: italic;
    }
  `,
})
export class DeploymentTable {
  /** The environment's three lists, exactly as the page holds them. */
  readonly node = input.required<EnvironmentNode>();

  /** Retry every request — the inline retry on a failed environment. */
  readonly reload = output<void>();

  /**
   * Which rows have an operation in flight, by application id.
   *
   * The page owns it because the page owns the request: the table would otherwise have to know
   * when a call finished, which is the one thing it deliberately does not do. A busy row draws
   * `queued…` rather than its buttons, because qits-deployments answers 202 and the result arrives
   * on the next read — offering the same button again in that window would let an operator queue
   * three restarts for one wedge.
   */
  readonly busy = input<ReadonlySet<string>>(new Set<string>());

  /**
   * What an operator pressed. The table never calls the service itself: the page holds the caches
   * every operation invalidates, and a component that both acted and displayed would have to hold
   * a second copy of them.
   */
  readonly operate = output<ApplicationOperation>();

  protected readonly shortSha = shortSha;
  protected readonly formatDayTime = formatDayTime;
  protected readonly formatInstant = formatInstant;
  protected readonly formatDuration = formatDuration;
  protected readonly formatAge = formatAge;
  protected readonly none = NONE;

  private readonly appLinks = inject(QitsAppLinks);

  /**
   * Where a run lives, as an absolute URL into qits-ci.
   *
   * The address is the platform's answer and not a constant: qits-ci is served at the root of its
   * own host, and the navigation is what says where that host is. A platform naming qits-ci
   * nowhere gives no honest address, and the sha is then drawn as text rather than as a link to
   * nowhere.
   */
  protected runHref(runId: string): string | undefined {
    return this.appLinks.href('qits-ci', `runs/${runId}`);
  }

  /**
   * The age column ticks off a local clock rather than a poll. Everything the server can change
   * arrives on the poll; this only moves the second hand, and a settled table must not generate
   * traffic to keep telling the truth about how old it is.
   */
  protected readonly now = tickingNow();

  private readonly open = signal<ReadonlySet<string>>(new Set());

  /**
   * The row whose Stop is waiting to be confirmed, or null.
   *
   * One at a time and local to the table: it is a question being asked, not state anybody would
   * link to, and it dies with the node exactly as the row expansion does.
   */
  protected readonly confirming = signal<string | null>(null);

  /** One state for the pair the table cannot be drawn without: the rows, and what fills them. */
  protected readonly state = computed(() =>
    both(this.node().applications, this.node().deployments),
  );

  /**
   * Why the requests are missing, or `''`.
   *
   * Said beside the table rather than instead of it, and that is the whole reason `requests` is not
   * in `state()`: everything on screen is still exactly what the server said ran. What is missing
   * is the one thing this table could otherwise be quietly wrong about — a release that asked for
   * something and got nothing — so it is named rather than left to look like an absence of releases.
   */
  protected readonly requestsProblem = computed(() => {
    const state = this.node().requests;
    return state.kind === 'error' ? state.message : '';
  });

  /**
   * One row per application, newest deployment first, everything behind it kept as history, and
   * every version ever asked for folded in beside it.
   *
   * History is defined by *age*, not by status. A `DECOMMISSIONED` filter would agree on the happy
   * path and be wrong everywhere else: a superseded `FAILED` attempt is history too, and a
   * decommissioned row that is the newest one is the application's current state and belongs in
   * the table rather than behind the affordance. Age is read off `createdAt` here rather than off
   * the list's order — `newestFirst`, and for the requests as well as the deployments, because both
   * buckets are read head-first and neither listing's order is something this component can check.
   *
   * **Requests join by name and deployments by id**, which is not an inconsistency but the two
   * keys the server offers: a deployment row records its plane so the server derives
   * `platform:<name>` or `<tier>:<name>` from it, and a request records no plane so there is
   * nothing to derive from and the name is the honest key. A name is unique per tier either way.
   *
   * Rows come out sorted by name, which is one rule for the tier's own services and the platform
   * ones merged in beside them — an ordering that depended on which listing a row came from would
   * be the old section back in everything but name.
   */
  protected readonly rows = computed<readonly Row[]>(() => {
    const state = this.state();
    if (state.kind !== 'ready') {
      return [];
    }
    const [applications, deployments] = state.value;
    const requestState = this.node().requests;
    const requests = requestState.kind === 'ready' ? requestState.value : [];

    const byApplication = new Map<string, CdDeploymentDto[]>();
    for (const deployment of deployments) {
      const bucket = byApplication.get(deployment.applicationId);
      if (bucket) {
        bucket.push(deployment);
      } else {
        byApplication.set(deployment.applicationId, [deployment]);
      }
    }
    // The row an operator reads as the application's state is the NEWEST one, and this is where
    // that is decided — see `newestFirst`. Ordering here rather than per row so every consumer
    // below (the current row, the history behind it, the leftover buckets) reads one ordering.
    for (const bucket of byApplication.values()) {
      newestFirst(bucket);
    }

    const byName = new Map<string, CdDeploymentRequestDto[]>();
    for (const request of requests) {
      const bucket = byName.get(request.applicationName);
      if (bucket) {
        bucket.push(request);
      } else {
        byName.set(request.applicationName, [request]);
      }
    }
    // And the same for the requests, for the same reason and by the same rule. `outstanding` reads
    // the head of this bucket, so an order inherited from the listing would let an older request
    // claim to be the version still waiting — a release drawn as unshipped after it shipped.
    for (const bucket of byName.values()) {
      newestFirst(bucket);
    }

    const build = (
      key: string,
      name: string,
      repoId: string | null,
      platform: boolean,
      history: readonly CdDeploymentDto[],
    ): Row => {
      const asked = byName.get(name) ?? [];
      byName.delete(name);
      const current = history[0] ?? null;
      const newest = asked[0] ?? null;
      return {
        key,
        name,
        repoId,
        platform,
        current,
        history: history.slice(1),
        requests: asked,
        outstanding: newest && newest.deploymentId !== current?.id ? newest : null,
        // The two the operator's levers are drawn from. `containerName` and nothing cleverer: under
        // swarm that string IS the service's name, and it is what qits-deployments resolves an
        // operation against — a deployment that never got that far has no service anywhere.
        actionable: !!current?.containerName,
        stopped: !!current && isStopped(current.status),
      };
    };

    const rows: Row[] = applications.map((application) => {
      const history = byApplication.get(application.id) ?? [];
      byApplication.delete(application.id);
      return build(
        application.id,
        application.name,
        application.repoId,
        application.target === 'PLATFORM',
        history,
      );
    });

    // Deployments whose application the environment no longer lists. The API gives no way for this
    // to happen today — applications come and go with their environment — but a row that exists and
    // is not drawn is the one failure this table must not have, so it is drawn and labelled rather
    // than filtered away on the assumption.
    for (const [applicationId, history] of byApplication) {
      rows.push(build(applicationId, history[0].applicationName, null, false, history));
    }

    // And the same for a release asked for under a name nothing here explains — the request outlives
    // the catalogue row by design, so a torn-down application's last refusal still has a line.
    for (const [name, asked] of byName) {
      rows.push({
        key: `request:${name}`,
        name,
        repoId: null,
        platform: false,
        current: null,
        history: [],
        requests: asked,
        outstanding: asked[0],
        // Nothing ran, so there is no service anywhere and no lever to draw. `actionable` says
        // exactly that, and it is why a refused release's line carries a sentence rather than a
        // Restart that would answer 409.
        actionable: false,
        stopped: false,
      });
    }

    return rows.sort((left, right) => left.name.localeCompare(right.name));
  });

  /** Nothing to open on a row with no deployment, no history and nothing ever asked for. */
  protected expandable(row: Row): boolean {
    return row.current !== null || row.history.length > 0 || row.requests.length > 0;
  }

  /** The gate's word, for the badge in the expanded row. */
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

  /** The short form beside an outstanding version in the table cell. */
  protected gateWord(request: CdDeploymentRequestDto): string {
    if (isPendingGate(request)) {
      return 'in the gate';
    }
    return isRefused(request) ? 'gate unmet' : 'requested';
  }

  /** What became of a request, which is the point of listing it at all. */
  protected outcome(request: CdDeploymentRequestDto): string {
    if (request.deploymentId) {
      return 'deployed';
    }
    return isPendingGate(request) ? 'nothing queued yet' : 'nothing was deployed';
  }

  /** The refusal in full, on hover, where the cell has room for a phrase and not a sentence. */
  protected requestTitle(request: CdDeploymentRequestDto): string {
    const asked = `${request.version} requested ${formatInstant(request.createdAt)}`;
    return request.gateDetail ? `${asked} — ${request.gateDetail}` : asked;
  }

  protected isOpen(key: string): boolean {
    return this.open().has(key);
  }

  /** Ask before stopping. Nothing is emitted here — this only opens the question. */
  protected askToStop(row: Row): void {
    this.confirming.set(row.key);
  }

  protected cancelStop(): void {
    this.confirming.set(null);
  }

  protected operateNow(row: Row, kind: OperationKind): void {
    this.confirming.set(null);
    this.operate.emit({ applicationId: row.key, applicationName: row.name, kind });
  }

  protected toggle(key: string): void {
    const next = new Set(this.open());
    if (!next.delete(key)) {
      next.add(key);
    }
    this.open.set(next);
  }
}
