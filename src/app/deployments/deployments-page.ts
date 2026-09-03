import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { QITS_SCOPE, QitsButton } from '@qits/ui-components';
import { CdApi } from '../api/cd-api';
import {
  isInFlight,
  isPendingGate,
  type CdApplicationDto,
  type CdDeploymentDto,
  type CdDeploymentRequestDto,
  type CdEnvironmentDto,
  type ProjectDto,
} from '../api/dto';
import { ProjectsApi } from '../api/projects-api';
import { injectScopedProject } from '../nav/scoped-project';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { DeploymentTable, UNVISITED, type EnvironmentNode } from './deployment-table';
import { TreeNode } from './tree-node';

/**
 * How often an environment with something in flight is re-read.
 *
 * Five seconds, and only while a visible deployment is `QUEUED` or `STARTING`. Deployments settle
 * in tens of seconds and then sit for days, so polling a settled table is pure waste — which is why
 * this page also carries a manual refresh, and why the interval stops the moment the last in-flight
 * row lands rather than running quietly forever behind an idle screen.
 */
export const POLL_INTERVAL_MS = 5000;

/** The comma-joined query parameter back as a set. */
function idSet(value: string | null): ReadonlySet<string> {
  return new Set((value ?? '').split(',').filter((id) => id.length > 0));
}

/** Add if missing, remove if present. */
function toggled(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids);
  if (!next.delete(id)) {
    next.add(id);
  }
  return next;
}

/** A map with one key replaced — the shape a signal of per-node state has to be updated in. */
function withEntry<T>(map: ReadonlyMap<string, T>, key: string, value: T): ReadonlyMap<string, T> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

/**
 * What is deployed where, read through the platform's projects.
 *
 * **The project → environment edge is `CdEnvironment.name === Project.slug`, and it is convention
 * only.** No column links them: qits-projects' `CdEnvironmentNotifier` POSTs `{name: slug, …}` when
 * a project is created, and the slug rather than the display name because cd validates the name as
 * a DNS label — which a slug already is — and because a slug cannot be renamed out from under the
 * environment it named. This page therefore draws a *match*, never a foreign key, and it shows
 * **both** kinds of non-match:
 *
 * - a project whose slug names no environment, which usually means the notifier failed and is
 *   exactly what an operator wants to see; and
 * - an environment no project's slug matches, in a bucket of its own that is drawn always, because
 *   "0 environments" is information.
 *
 * Neither direction needs a service gap. `GET /platform-deployments/api/environments` returns
 * everything, so the unmatched set is a client-side difference — the asymmetry with the ci
 * explorer, whose run listing
 * takes a mandatory repository filter and therefore cannot see its own orphans without one.
 *
 * **The platform services are listed under the environment they are deployed to, and there is no
 * section for them.** There used to be: a platform service belonged to no environment at all, so no
 * project and no tier could lead to it and a third root was the only way to draw it. It belongs to
 * one now — the designated environment is where the plane is deployed, and its deployment rows name
 * that tier like any other — so it is one more row in that tier's table, with a `platform` tag on
 * the row saying the one thing that is still true of it: it is linked into no environment, which is
 * why one release of it reaches every tier at once. The section outlived the model it came from,
 * and a root that holds services that *are* in an environment is a lie about where they run.
 *
 * The catalogue still cannot list them through the environment — a platform service carries no link,
 * deliberately — so `GET /applications` is where they come from, and the page merges that listing
 * into the one environment whose `platform` flag says the plane deploys there.
 *
 * **Two requests on load, both flat lists**; everything below costs a click (Decision 3). Expanding
 * a project costs three more — the environment's applications, its deployments and its deployment
 * requests, none of which the listing carries — and a fourth for the designated environment, whose
 * platform services come off the flat catalogue.
 *
 * Expansion lives in the query parameters
 * (`/platform-deployments/?project=…`, and `env=` for the bucket) rather than in path segments: it
 * is view state, the path is for resources, and a history entry per expansion is what makes the
 * back button mean
 * "collapse".
 */
@Component({
  selector: 'app-deployments-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, DeploymentTable, Empty, QitsButton, TreeNode],
  templateUrl: './deployments-page.html',
  styleUrl: './deployments-page.css',
})
export class DeploymentsPage {
  /** The project the address names — what the header says, and what the table opens on arrival. */
  protected readonly scoped = injectScopedProject();

  /**
   * The scoped project's **id**, which is what the expansion is keyed by. The address carries the
   * slug; the library resolves it against the project list, so this is `undefined` until that list
   * answers and the row opens when it does.
   */
  private readonly scopeSource = inject(QITS_SCOPE, { optional: true });

  private readonly projectsApi = inject(ProjectsApi);
  private readonly cdApi = inject(CdApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);

  /** The project spine. */
  protected readonly projects = signal<Loadable<readonly ProjectDto[]>>(LOADING);

  /** Every environment cd holds — the other half of both orphan directions. */
  protected readonly environments = signal<Loadable<readonly CdEnvironmentDto[]>>(LOADING);

  /**
   * Per environment, its applications — the tier's own, plus the platform services where the plane
   * deploys. A missing key is an environment nobody has expanded.
   */
  protected readonly applications = signal<
    ReadonlyMap<string, Loadable<readonly CdApplicationDto[]>>
  >(new Map());

  /** Per environment, its deployments, newest first across all of its applications. */
  protected readonly deployments = signal<
    ReadonlyMap<string, Loadable<readonly CdDeploymentDto[]>>
  >(new Map());

  /**
   * Per environment, the versions asked for in it, newest first.
   *
   * A third cache rather than a field on the deployments, for the reason it is a third endpoint: a
   * request the gate refused produced no deployment, so it cannot be reached through one.
   */
  protected readonly requests = signal<
    ReadonlyMap<string, Loadable<readonly CdDeploymentRequestDto[]>>
  >(new Map());

  /**
   * The unmatched-environments bucket starts open. Opening it costs no request — the environments
   * arrived with the page and their children are still collapsed — and an environment nothing
   * claims is the thing on this screen most likely to be a mistake, so it is not put behind a
   * click.
   */
  protected readonly bucketOpen = signal(true);

  /** A poll that failed, said beside the table rather than instead of it. */
  protected readonly pollProblem = signal('');

  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });

  /**
   * Which project rows are open: what `?project=` names, plus the project the address scopes.
   *
   * The scope is a **seed** and not an override — `?project=` is still the reader's statement, and
   * a scoped project can be collapsed like any other. What makes that work is `navigate` below,
   * which writes an empty `?project=` rather than dropping the parameter while a scope is in force:
   * an absent parameter would let the seed put the row straight back.
   */
  protected readonly expandedProjects = computed(() => {
    const named = idSet(this.queryParams().get('project'));
    const scoped = this.scopeSource?.projectId();
    if (!scoped || this.queryParams().has('project')) return named;
    return new Set([...named, scoped]);
  });
  protected readonly expandedEnvironments = computed(() => idSet(this.queryParams().get('env')));

  protected readonly projectList = computed(() => {
    const state = this.projects();
    return state.kind === 'ready' ? state.value : [];
  });

  protected readonly environmentList = computed(() => {
    const state = this.environments();
    return state.kind === 'ready' ? state.value : [];
  });

  /** The join, in one map: an environment by the name a project slug has to equal to claim it. */
  private readonly environmentsByName = computed(
    () => new Map(this.environmentList().map((environment) => [environment.name, environment])),
  );

  /**
   * The environments no project's slug names. Computed against the whole project list rather than
   * against the expanded ones — unlike the ci tree's bucket, both of this page's roots are complete
   * on arrival, so this set is final from the first render and never shifts under the reader.
   */
  protected readonly unmatchedEnvironments = computed(() => {
    const slugs = new Set(this.projectList().map((project) => project.slug));
    return this.environmentList().filter((environment) => !slugs.has(environment.name));
  });

  /**
   * The environment a release enters the platform at and the platform plane is deployed into, or
   * null while the environments are loading and when none is designated. Exactly one row carries
   * the flag; `find` rather than a lookup because the server holds that invariant, not this client.
   *
   * It is what decides where the platform services are listed. They carry no link into it — that is
   * what being platform-tier means — so this flag is the only thing on the wire that says where
   * they run, and an install with none designated is one where nothing can deploy at all.
   */
  protected readonly platformEnvironment = computed(
    () => this.environmentList().find((environment) => environment.platform) ?? null,
  );

  /** Both roots failed: there is no page to draw around that gap. */
  protected readonly unrecoverable = computed(
    () => this.projects().kind === 'error' && this.environments().kind === 'error',
  );

  /** Projects are down but cd answered: the bucket alone, behind a banner that says why. */
  protected readonly projectsBanner = computed(() => {
    const state = this.projects();
    return state.kind === 'error' && !this.unrecoverable() ? state.message : '';
  });

  /**
   * cd is down but projects answered: the project spine, behind a banner. Every project's
   * expansion then shows the environments error rather than the "no environment exists" sentence —
   * claiming an environment is absent when the service that would know is unreachable would be the
   * page's one outright lie.
   */
  protected readonly environmentsBanner = computed(() => {
    const state = this.environments();
    return state.kind === 'error' && !this.unrecoverable() ? state.message : '';
  });

  /** Whatever went wrong at the root, for the full-page error. */
  protected readonly rootError = computed(() => {
    const state = this.projects();
    return state.kind === 'error' ? state.message : '';
  });

  protected readonly summary = computed(() => {
    const projects = this.projectList().length;
    const environments = this.environmentList().length;
    const unmatched = this.unmatchedEnvironments().length;
    return (
      `${projects} ${projects === 1 ? 'project' : 'projects'} · ` +
      `${environments} ${environments === 1 ? 'environment' : 'environments'} · ` +
      `${unmatched} unmatched.`
    );
  });

  /** Every environment currently on screen: the matched ones opened, and the bucket's own. */
  private readonly openEnvironmentIds = computed<readonly string[]>(() => {
    const ids = new Set<string>();
    for (const project of this.projectList()) {
      if (this.expandedProjects().has(project.id)) {
        const environment = this.environmentsByName().get(project.slug);
        if (environment) {
          ids.add(environment.id);
        }
      }
    }
    for (const environment of this.unmatchedEnvironments()) {
      if (this.expandedEnvironments().has(environment.id)) {
        ids.add(environment.id);
      }
    }
    return [...ids];
  });

  /**
   * The environments worth polling: on screen, and holding something that has not landed — a
   * deployment still moving, or a request still in the gate.
   *
   * "Visible" is the whole test. A collapsed environment's cached rows are not being read by
   * anybody, and re-reading them would be traffic for a table nobody is looking at.
   *
   * The gate is in the test even though today's placeholder settles inside the transaction that
   * writes the request, so nothing is ever seen pending. The lifecycle this page follows is request
   * → gate → deployment, and a poll that watched only the third step would go quiet on the day the
   * first gate takes a minute — which is the day it matters most.
   */
  private readonly followed = computed<readonly string[]>(() =>
    this.openEnvironmentIds().filter((environmentId) => {
      const deployments = this.deployments().get(environmentId);
      const requests = this.requests().get(environmentId);
      const deploying =
        deployments?.kind === 'ready' &&
        deployments.value.some((deployment) => isInFlight(deployment.status));
      const gating = requests?.kind === 'ready' && requests.value.some(isPendingGate);
      return deploying || gating;
    }),
  );

  /** `following 2 environments`, and only while there is something to follow. */
  protected readonly following = computed(() => {
    const count = this.followed().length;
    return count === 0 ? '' : `following ${count} ${count === 1 ? 'environment' : 'environments'}`;
  });

  constructor() {
    void this.reload();

    // What the URL says is open, is open — on first load, on a deep link, and on the back button.
    // It re-runs when the environments arrive, which is what makes a deep link into a project work
    // before the join is even computable.
    effect(() => {
      for (const environmentId of this.openEnvironmentIds()) {
        if (!this.applications().has(environmentId)) {
          void this.loadEnvironment(environmentId);
        }
      }
    });

    // Start or stop the poll as the in-flight set changes. Nothing else turns it on.
    effect(() => {
      this.followed();
      this.syncPolling();
    });

    const onVisibilityChange = () => this.onVisibilityChange();
    this.document.addEventListener('visibilitychange', onVisibilityChange);
    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisibilityChange);
      this.stopPolling();
    });
  }

  /** The one button in the header: drop every cache and read the two roots again. */
  protected async reload(): Promise<void> {
    this.applications.set(new Map());
    this.deployments.set(new Map());
    this.requests.set(new Map());
    this.pollProblem.set('');
    await Promise.all([this.loadProjects(), this.loadEnvironments()]);
  }

  protected async loadProjects(): Promise<void> {
    this.projects.set(LOADING);
    try {
      this.projects.set(ready(await this.projectsApi.projects()));
    } catch (error) {
      this.projects.set(failed(error));
    }
  }

  protected async loadEnvironments(): Promise<void> {
    this.environments.set(LOADING);
    try {
      this.environments.set(ready(await this.cdApi.environments()));
    } catch (error) {
      this.environments.set(failed(error));
    }
  }

  /**
   * One environment's three lists, in parallel. All three are written `loading` before any is
   * awaited, so the keys exist by the time the expansion effect could run again and no request is
   * issued twice.
   *
   * **The applications are the tier's own plus, for the designated environment, the platform
   * services.** That merge is here rather than in the table because it is a fact about the API and
   * not about rendering: the catalogue deliberately records no link for a platform service, so the
   * environment aggregate cannot list one, and the flat listing is the only place it exists. Below
   * this line a platform service is one more application in this environment, which is what it is.
   *
   * A failed catalogue read fails the environment; a failed platform read does not, and that
   * asymmetry is deliberate — the tier's own services are the table, and the platform ones are
   * additions to it. Losing them costs rows, and losing the tier's costs the table.
   */
  protected async loadEnvironment(environmentId: string): Promise<void> {
    this.applications.update((map) => withEntry(map, environmentId, LOADING));
    this.deployments.update((map) => withEntry(map, environmentId, LOADING));
    this.requests.update((map) => withEntry(map, environmentId, LOADING));
    await Promise.all([
      (async () => {
        try {
          // In parallel, not in sequence: they are two independent listings, and chaining them
          // would put the flat catalogue's latency behind the aggregate's for no reason.
          const [own, platform] = await Promise.all([
            this.cdApi.applications(environmentId),
            this.platformApplicationsOf(environmentId),
          ]);
          this.applications.update((map) =>
            withEntry(map, environmentId, ready([...own, ...platform])),
          );
        } catch (error) {
          this.applications.update((map) => withEntry(map, environmentId, failed(error)));
        }
      })(),
      (async () => {
        try {
          const deployments = await this.cdApi.deployments(environmentId);
          this.deployments.update((map) => withEntry(map, environmentId, ready(deployments)));
        } catch (error) {
          this.deployments.update((map) => withEntry(map, environmentId, failed(error)));
        }
      })(),
      (async () => {
        try {
          const requests = await this.cdApi.deploymentRequests(environmentId);
          this.requests.update((map) => withEntry(map, environmentId, ready(requests)));
        } catch (error) {
          this.requests.update((map) => withEntry(map, environmentId, failed(error)));
        }
      })(),
    ]);
  }

  /**
   * The platform services, for the one environment the plane deploys into, and `[]` for every
   * other — so the flat catalogue is read once per expansion of that environment and never at all
   * for the rest.
   *
   * A read that fails answers `[]` rather than failing the environment: see `loadEnvironment`.
   */
  private async platformApplicationsOf(
    environmentId: string,
  ): Promise<readonly CdApplicationDto[]> {
    if (this.platformEnvironment()?.id !== environmentId) {
      return [];
    }
    try {
      return await this.cdApi.platformApplications();
    } catch {
      return [];
    }
  }

  /**
   * One poll of every followed environment: its deployments and its requests. The applications are
   * not re-read — what an environment tracks does not change while a container starts — and the
   * poll does **not** drop the table back to a skeleton: the rows on screen are still the last thing
   * the server said, and blanking them every five seconds would make a starting deployment
   * unreadable.
   *
   * The requests are polled beside the deployments because they are the first step of the same
   * lifecycle: a release lands as a request before it is anything else, so a table that re-read only
   * the deployments would show a new version arriving with no record of it having been asked for.
   */
  private async poll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      await Promise.all(
        this.followed().map(async (environmentId) => {
          try {
            const [deployments, requests] = await Promise.all([
              this.cdApi.deployments(environmentId),
              this.cdApi.deploymentRequests(environmentId),
            ]);
            this.deployments.update((map) => withEntry(map, environmentId, ready(deployments)));
            this.requests.update((map) => withEntry(map, environmentId, ready(requests)));
            this.pollProblem.set('');
          } catch (error) {
            this.pollProblem.set(describeError(error));
          }
        }),
      );
    } finally {
      this.polling = false;
      this.syncPolling();
    }
  }

  /** Poll only while a visible deployment is non-terminal, and never behind a hidden tab. */
  private shouldPoll(): boolean {
    return this.followed().length > 0 && !this.document.hidden;
  }

  private syncPolling(): void {
    if (this.shouldPoll()) {
      this.pollHandle ??= setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    } else {
      this.stopPolling();
    }
  }

  private stopPolling(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  /**
   * A hidden tab polls nothing. Coming back is worth one immediate read rather than up to five
   * seconds of stale screen, and then the interval takes over again.
   */
  private onVisibilityChange(): void {
    if (this.shouldPoll()) {
      void this.poll();
    }
    this.syncPolling();
  }

  /** The environment a project's slug names, or null — and null is a rendered sentence. */
  protected environmentOf(project: ProjectDto): CdEnvironmentDto | null {
    return this.environmentsByName().get(project.slug) ?? null;
  }

  protected nodeOf(environmentId: string): EnvironmentNode {
    const applications = this.applications().get(environmentId);
    const deployments = this.deployments().get(environmentId);
    const requests = this.requests().get(environmentId);
    return applications === undefined || deployments === undefined || requests === undefined
      ? UNVISITED
      : { applications, deployments, requests };
  }

  /** `environment "qits" · network qits-net` — what the match resolved to, spelled out. */
  protected projectMeta(project: ProjectDto): string {
    if (this.environments().kind !== 'ready') {
      return '';
    }
    const environment = this.environmentOf(project);
    return environment
      ? `environment "${environment.name}" · ${this.environmentMeta(environment)}`
      : 'no environment';
  }

  /**
   * The environment's own line. No branch — a release names a tag, and the column is gone from the
   * API — and the platform designation is said out loud, because it is what explains why the
   * platform services are in this tier's table and in no other's.
   */
  protected environmentMeta(environment: CdEnvironmentDto): string {
    const meta = `network ${environment.network}`;
    return environment.platform ? `${meta} · platform environment` : meta;
  }

  /**
   * The sentence for a project whose slug names nothing in qits-deployments. It quotes the *slug*,
   * not the project's display name, because the slug is what the convention actually compares — an
   * operator chasing this reads it against `GET /platform-deployments/api/environments` and the two
   * have to be the same string.
   */
  protected noEnvironmentMessage(project: ProjectDto): string {
    return `No environment named "${project.slug}" exists in qits-deployments.`;
  }

  /** The bucket's own count, drawn whether or not there is anything in it. */
  protected bucketMeta(): string {
    const count = this.unmatchedEnvironments().length;
    return `${count} ${count === 1 ? 'environment' : 'environments'}`;
  }

  /**
   * The sentence for an install where no environment is designated, or `''`.
   *
   * The one fact the tables cannot show, because it is about their absence: a release enters the
   * platform at the designated environment, so with none designated nothing deploys anywhere and
   * every table on this page is empty for a reason no row can state. It replaced the platform
   * bucket's meta line, which was where this used to be said.
   *
   * Silent while the environments are still loading — an unanswered question is not a missing
   * designation.
   */
  protected noPlatformEnvironment(): string {
    return this.environments().kind === 'ready' && this.platformEnvironment() === null
      ? 'No environment is the platform environment — a release enters nowhere and nothing here can deploy.'
      : '';
  }

  protected toggleBucket(): void {
    this.bucketOpen.update((open) => !open);
  }

  protected toggleProject(projectId: string): void {
    this.navigate('project', toggled(this.expandedProjects(), projectId));
  }

  protected toggleEnvironment(environmentId: string): void {
    this.navigate('env', toggled(this.expandedEnvironments(), environmentId));
  }

  /**
   * A history entry on purpose, not `replaceUrl`: back should collapse what forward expanded.
   * `merge` keeps the other key's parameter, and an empty set is written as null so the parameter
   * disappears rather than lingering as `?project=`.
   */
  private navigate(key: 'project' | 'env', ids: ReadonlySet<string>): void {
    // An empty set normally drops the parameter, which keeps the address clean. The one exception
    // is a collapsed project list under a project scope: there the absent parameter reads as "no
    // statement" and the scope's seed would reopen the row the reader just closed. An empty value
    // is the statement that nothing is open.
    const empty = key === 'project' && this.scopeSource?.projectId() ? '' : null;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: ids.size > 0 ? [...ids].join(',') : empty },
      queryParamsHandling: 'merge',
    });
  }
}
