import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { QitsAppLinks } from '@qits/ui-components';
import { isStopped, type CdApplicationDto, type CdDeploymentDto } from '../api/dto';
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
 * One plane as this page holds it — an environment, or the platform — as the two lists an expansion
 * fetches, each with its own state so a retry knows what to re-ask for.
 *
 * The name is the environment's because that is the only plane this table drew for a release, and
 * the platform one arrived into the same shape rather than beside it: both are "applications, and
 * what is deployed of them", and nothing below this line can tell them apart.
 */
export interface EnvironmentNode {
  readonly applications: Loadable<readonly CdApplicationDto[]>;
  readonly deployments: Loadable<readonly CdDeploymentDto[]>;
}

/** A plane nobody has expanded: no request made, and that is a state rather than an absence. */
export const UNVISITED: EnvironmentNode = { applications: IDLE, deployments: IDLE };

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

/** One row, from the application it belongs to and the deployments that name it. */
function row(
  key: string,
  name: string,
  repoId: string | null,
  history: readonly CdDeploymentDto[],
): Row {
  const current = history[0] ?? null;
  return {
    key,
    name,
    repoId,
    current,
    history: history.slice(1),
    actionable: !!current?.containerName,
    stopped: !!current && isStopped(current.status),
  };
}

/** One application's line in the table, and the history hanging behind it. */
interface Row {
  /** The application id, or the deployment's own when the environment no longer tracks it. */
  readonly key: string;
  readonly name: string;
  /** Null for a row the applications list does not explain — see `rows()`. */
  readonly repoId: string | null;
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
}

/**
 * The current deployments of one environment: one row per application, and what is deployed there
 * right now.
 *
 * **The rows come from the environment's `applications`, not from the deployment list.** That is
 * the load-bearing choice: an application that has never been deployed has no deployment row to be
 * derived from, so deriving the table from deployments would silently drop exactly the application
 * an operator is looking for — the one that should be running and is not. It gets a row reading
 * *never deployed* instead.
 *
 * **"Current" is the first row per `applicationId`** in a list the server already sorted newest
 * first. One client-side pass, no third request, and `CdDeploymentDto` carries `applicationName`
 * so nothing has to be looked up. Everything behind that first row is history: a redeploy
 * decommissions its predecessor, so it is the same application's past rather than its state, and it
 * stays behind the row's own expansion rather than doubling the table's length by default.
 *
 * The expansion is local state and deliberately not in the URL. The query parameters carry the two
 * levels that cost a request (Decision 4); a third parameter for something free would be URL noise,
 * and it dies with the node, which is the honest lifetime — a collapsed environment has no rows.
 */
@Component({
  selector: 'app-deployment-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, StatusBadge],
  template: `
    <app-async
      [state]="state()"
      loadingLabel="Loading deployments"
      errorLabel="Could not load deployments"
      (retry)="reload.emit()"
    />

    @if (state().kind === 'ready') {
      @if (rows().length === 0) {
        <app-empty [message]="emptyMessage()" />
      } @else {
        <table class="deployments">
          <thead>
            <tr>
              <th scope="col">Application</th>
              <th scope="col">Repository</th>
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
                  <td colspan="7">
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
                    @if (row.history.length > 0) {
                      <p class="history-head">
                        {{ row.history.length }} earlier
                        {{ row.history.length === 1 ? 'deployment' : 'deployments' }}
                      </p>
                      <ul class="history">
                        @for (deployment of row.history; track deployment.id) {
                          <li>
                            <app-status-badge [status]="deployment.status" />
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
    .twist {
      display: flex;
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
    .never,
    .untracked {
      color: #6b7280;
      font-style: italic;
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
    .history-head {
      margin: 0 0 0.2rem;
      color: #6b7280;
      font-size: 0.85rem;
    }
    .history {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .history li {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      padding: 0.1rem 0;
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
  /** The plane's two lists, exactly as the page holds them. */
  readonly node = input.required<EnvironmentNode>();

  /**
   * What an empty table says. It is a caller's sentence because the table draws two kinds of plane
   * now, and a platform bucket reading "this environment tracks no applications" would name a thing
   * that does not exist.
   */
  readonly emptyMessage = input('This environment tracks no applications.');

  /** Retry both requests — the inline retry on a failed environment. */
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

  /** One state for the pair, because the table needs both lists or neither. */
  protected readonly state = computed(() =>
    both(this.node().applications, this.node().deployments),
  );

  /**
   * One row per application, newest deployment first, everything behind it kept as history.
   *
   * History is defined by *position*, not by status. A `DECOMMISSIONED` filter would agree on the
   * happy path and be wrong everywhere else: a superseded `FAILED` attempt is history too, and a
   * decommissioned row that is the newest one is the application's current state and belongs in
   * the table rather than behind the affordance.
   */
  protected readonly rows = computed<readonly Row[]>(() => {
    const state = this.state();
    if (state.kind !== 'ready') {
      return [];
    }
    const [applications, deployments] = state.value;

    const byApplication = new Map<string, CdDeploymentDto[]>();
    for (const deployment of deployments) {
      const bucket = byApplication.get(deployment.applicationId);
      if (bucket) {
        bucket.push(deployment);
      } else {
        byApplication.set(deployment.applicationId, [deployment]);
      }
    }

    const rows: Row[] = applications.map((application) => {
      const history = byApplication.get(application.id) ?? [];
      byApplication.delete(application.id);
      return row(application.id, application.name, application.repoId, history);
    });

    // Deployments whose application the environment no longer lists. The API gives no way for this
    // to happen today — applications come and go with their environment — but a row that exists and
    // is not drawn is the one failure this table must not have, so it is drawn and labelled rather
    // than filtered away on the assumption.
    for (const [applicationId, history] of byApplication) {
      rows.push(row(applicationId, history[0].applicationName, null, history));
    }
    return rows;
  });

  /** Nothing to open on a row that has never been deployed and has no history behind it. */
  protected expandable(row: Row): boolean {
    return row.current !== null || row.history.length > 0;
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
