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
import { QitsButton } from '@qits/ui-components';
import { CdApi } from '../api/cd-api';
import {
  PLATFORM_PLANE,
  isInFlight,
  type CdApplicationDto,
  type CdDeploymentDto,
  type CdEnvironmentDto,
  type ProjectDto,
} from '../api/dto';
import { ProjectsApi } from '../api/projects-api';
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
 * **The platform plane is a root of its own, beside the projects.** An application deployed once
 * for the whole platform — qits-platform-idp, qits-ci, this component — belongs to no environment,
 * so no project and no tier can lead to it: reading this page through the projects alone showed
 * three of the platform's eleven applications and gave no hint the other eight existed. It is drawn
 * as a third root rather than folded into every environment because it is not in any of them; `GET
 * /applications` is the flat listing that reaches it and `?environmentId=platform` is its
 * deployment history.
 *
 * **Two requests on load, both flat lists**; everything below costs a click (Decision 3). Expanding
 * a project costs two more, because the environment listing answers `applications: null` by design
 * and the deployment listing is a separate resource — and the platform bucket costs the same two,
 * which is why it starts closed while the unmatched-environments bucket starts open. That bucket is
 * free (its contents arrived with the page); this one is not, and Decision 3 does not stop applying
 * to a root just because the root is interesting.
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
   * Per plane, its applications. A missing key is a plane nobody has expanded.
   *
   * The key is an environment id or {@link PLATFORM_PLANE}, in one map rather than two: they cannot
   * collide (an environment id is a random UUID), and everything that reads these caches — the
   * table, the poll, the expansion effect — asks the same question of both.
   */
  protected readonly applications = signal<
    ReadonlyMap<string, Loadable<readonly CdApplicationDto[]>>
  >(new Map());

  /** Per plane, its deployments, newest first across all of its applications. */
  protected readonly deployments = signal<
    ReadonlyMap<string, Loadable<readonly CdDeploymentDto[]>>
  >(new Map());

  /**
   * The unmatched-environments bucket starts open. Opening it costs no request — the environments
   * arrived with the page and their children are still collapsed — and an environment nothing
   * claims is the thing on this screen most likely to be a mistake, so it is not put behind a
   * click.
   */
  protected readonly bucketOpen = signal(true);

  /**
   * The platform bucket, closed until asked for — unlike the one above it, opening this costs the
   * two requests every other expansion costs.
   *
   * Local state rather than a query parameter, and that is the same rule the other bucket follows:
   * the URL carries the two levels a *reader* would want to link to, and a root that is always on
   * screen is not one of them.
   */
  protected readonly platformOpen = signal(false);

  /** The plane's key, for the template — it addresses the caches like any environment id. */
  protected readonly platformPlane = PLATFORM_PLANE;

  /** A poll that failed, said beside the table rather than instead of it. */
  protected readonly pollProblem = signal('');

  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });

  protected readonly expandedProjects = computed(() => idSet(this.queryParams().get('project')));
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

  /**
   * Every plane currently on screen: the matched environments opened, the bucket's own, and the
   * platform plane when its bucket is open.
   */
  private readonly openPlaneIds = computed<readonly string[]>(() => {
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
    if (this.platformOpen()) {
      ids.add(PLATFORM_PLANE);
    }
    return [...ids];
  });

  /**
   * The planes worth polling: on screen, and holding a deployment that is still moving.
   *
   * "Visible" is the whole test. A collapsed plane's cached rows are not being read by anybody, and
   * re-reading them would be traffic for a table nobody is looking at.
   */
  private readonly followed = computed<readonly string[]>(() =>
    this.openPlaneIds().filter((planeId) => {
      const state = this.deployments().get(planeId);
      return (
        state?.kind === 'ready' && state.value.some((deployment) => isInFlight(deployment.status))
      );
    }),
  );

  /**
   * `following 2 planes`, and only while there is something to follow.
   *
   * "Plane" rather than "environment" because the platform is one of the things that can be
   * followed and is not an environment — a self-update of qits-deployments is exactly the
   * deployment a reader watches this line for.
   */
  protected readonly following = computed(() => {
    const count = this.followed().length;
    return count === 0 ? '' : `following ${count} ${count === 1 ? 'plane' : 'planes'}`;
  });

  constructor() {
    void this.reload();

    // What the URL says is open, is open — on first load, on a deep link, and on the back button.
    // It re-runs when the environments arrive, which is what makes a deep link into a project work
    // before the join is even computable.
    effect(() => {
      for (const planeId of this.openPlaneIds()) {
        if (!this.applications().has(planeId)) {
          void this.loadPlane(planeId);
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
   * One plane's two lists, in parallel. Both are written `loading` before either is awaited, so the
   * key exists by the time the expansion effect could run again and the request is never issued
   * twice.
   *
   * **The one branch between the two planes is which listing holds the applications**, and it is
   * here rather than in two methods: the deployment listing takes the plane's key either way, both
   * results go into the same caches under the same key, and every failure and retry below is the
   * same code. An environment reads its own aggregate; the platform reads the flat catalogue,
   * because there is no environment resource to read it through.
   */
  protected async loadPlane(planeId: string): Promise<void> {
    this.applications.update((map) => withEntry(map, planeId, LOADING));
    this.deployments.update((map) => withEntry(map, planeId, LOADING));
    await Promise.all([
      (async () => {
        try {
          const applications =
            planeId === PLATFORM_PLANE
              ? await this.cdApi.platformApplications()
              : await this.cdApi.applications(planeId);
          this.applications.update((map) => withEntry(map, planeId, ready(applications)));
        } catch (error) {
          this.applications.update((map) => withEntry(map, planeId, failed(error)));
        }
      })(),
      (async () => {
        try {
          const deployments = await this.cdApi.deployments(planeId);
          this.deployments.update((map) => withEntry(map, planeId, ready(deployments)));
        } catch (error) {
          this.deployments.update((map) => withEntry(map, planeId, failed(error)));
        }
      })(),
    ]);
  }

  /**
   * One poll of every followed plane. It re-reads the deployments only — the applications a plane
   * tracks do not change while a container starts — and it does **not** drop the table back to a
   * skeleton: the rows on screen are still the last thing the server said, and blanking them every
   * five seconds would make a starting deployment unreadable.
   */
  private async poll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      await Promise.all(
        this.followed().map(async (planeId) => {
          try {
            const deployments = await this.cdApi.deployments(planeId);
            this.deployments.update((map) => withEntry(map, planeId, ready(deployments)));
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

  protected nodeOf(planeId: string): EnvironmentNode {
    const applications = this.applications().get(planeId);
    const deployments = this.deployments().get(planeId);
    return applications === undefined || deployments === undefined
      ? UNVISITED
      : { applications, deployments };
  }

  /** `environment "qits" · main · network qits-net` — what the match resolved to, spelled out. */
  protected projectMeta(project: ProjectDto): string {
    if (this.environments().kind !== 'ready') {
      return '';
    }
    const environment = this.environmentOf(project);
    return environment
      ? `environment "${environment.name}" · ${environment.branch} · network ${environment.network}`
      : 'no environment';
  }

  protected environmentMeta(environment: CdEnvironmentDto): string {
    return `${environment.branch} · network ${environment.network}`;
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
   * The platform bucket's count, and only once it has been read. A closed bucket has asked nothing,
   * so there is no number to draw — and inventing one would be the same lie as a table full of
   * "never deployed".
   */
  protected platformMeta(): string {
    const state = this.applications().get(PLATFORM_PLANE);
    if (state?.kind !== 'ready') {
      return '';
    }
    const count = state.value.length;
    return `${count} ${count === 1 ? 'service' : 'services'}`;
  }

  protected toggleBucket(): void {
    this.bucketOpen.update((open) => !open);
  }

  protected togglePlatform(): void {
    this.platformOpen.update((open) => !open);
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
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: ids.size > 0 ? [...ids].join(',') : null },
      queryParamsHandling: 'merge',
    });
  }
}
