import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { CdApplicationDto, CdDeploymentDto } from '../api/dto';
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
 * One environment as this page holds it: the two lists an expansion fetches, each with its own
 * state so a retry knows what to re-ask for.
 */
export interface EnvironmentNode {
  readonly applications: Loadable<readonly CdApplicationDto[]>;
  readonly deployments: Loadable<readonly CdDeploymentDto[]>;
}

/** An environment nobody has expanded: no request made, and that is a state rather than an absence. */
export const UNVISITED: EnvironmentNode = { applications: IDLE, deployments: IDLE };

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
        <app-empty message="This environment tracks no applications." />
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
                    @if (deployment.runId) {
                      <!--
                        A plain href, never a routerLink: /ci/ is a different application served by
                        a different service behind the same gateway, and routing to it in-app would
                        hand the URL to this SPA's router, which owns nothing outside /cd/.
                      -->
                      <a
                        [href]="'/ci/runs/' + deployment.runId"
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
              </tr>
              @if (isOpen(row.key)) {
                <tr class="expanded">
                  <td colspan="6">
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
                            @if (deployment.runId) {
                              <a
                                [href]="'/ci/runs/' + deployment.runId"
                                [title]="deployment.commitSha"
                                >{{ shortSha(deployment.commitSha) }}</a
                              >
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
  `,
})
export class DeploymentTable {
  /** The environment's two lists, exactly as the page holds them. */
  readonly node = input.required<EnvironmentNode>();

  /** Retry both requests — the inline retry on a failed environment. */
  readonly reload = output<void>();

  protected readonly shortSha = shortSha;
  protected readonly formatDayTime = formatDayTime;
  protected readonly formatInstant = formatInstant;
  protected readonly formatDuration = formatDuration;
  protected readonly formatAge = formatAge;
  protected readonly none = NONE;

  /**
   * The age column ticks off a local clock rather than a poll. Everything the server can change
   * arrives on the poll; this only moves the second hand, and a settled table must not generate
   * traffic to keep telling the truth about how old it is.
   */
  protected readonly now = tickingNow();

  private readonly open = signal<ReadonlySet<string>>(new Set());

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
      return {
        key: application.id,
        name: application.name,
        repoId: application.repoId,
        current: history[0] ?? null,
        history: history.slice(1),
      };
    });

    // Deployments whose application the environment no longer lists. The API gives no way for this
    // to happen today — applications come and go with their environment — but a row that exists and
    // is not drawn is the one failure this table must not have, so it is drawn and labelled rather
    // than filtered away on the assumption.
    for (const [applicationId, history] of byApplication) {
      rows.push({
        key: applicationId,
        name: history[0].applicationName,
        repoId: null,
        current: history[0],
        history: history.slice(1),
      });
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

  protected toggle(key: string): void {
    const next = new Set(this.open());
    if (!next.delete(key)) {
      next.add(key);
    }
    this.open.set(next);
  }
}
