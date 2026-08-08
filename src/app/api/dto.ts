/**
 * The wire shapes this client reads, hand-written and copied field-for-field from the Java records
 * on the other side (`CdEnvironmentDto`, `CdApplicationDto`, `CdDeploymentDto` in qits-deployments;
 * `ProjectDto` in qits-projects).
 *
 * Hand-written rather than generated, deliberately (the explorer plan's Decision 1). The platform
 * generates OpenAPI *documents*, not clients, and every controller nests its request and response
 * records inside the request type, so a generator names them positionally — qits-projects'
 * committed document already calls the list-projects response `Response19` and one entry `Entry4`.
 * A page written against `Entry4` is worse than one written against the interfaces below, and the
 * whole surface this app reads is three endpoints plus one.
 *
 * The envelopes are genuinely inconsistent across the two services — `{environments: […]}` for cd's
 * environment list, `{environment: …}` for its single read, `{deployments: […]}` for deployments,
 * `{entries: [{project: …}]}` for projects — and the interfaces say so rather than pretending
 * otherwise. Straightening them out is the servers' business, not this client's.
 *
 * These interfaces are duplicated from qits-spa-ci where they overlap (`ProjectDto`, the loadable
 * envelope shapes) rather than shared. Decision 2: that is forty lines against a library publish
 * and a version bump in seven applications every time one of them moves.
 *
 * `Instant` arrives as an ISO-8601 string; every timestamp below is typed as one and parsed only
 * where it is formatted.
 */

/**
 * A deployment's state. `QUEUED` and `STARTING` are the two non-terminal ones, and that is the
 * whole rule behind Decision 5's poll — everything else sits still for days.
 */
export type CdDeploymentStatus =
  'QUEUED' | 'STARTING' | 'ACTIVE' | 'IMAGE_MISSING' | 'FAILED' | 'DECOMMISSIONED';

/** The statuses a poll is waiting on. Anything else is settled. */
const IN_FLIGHT: readonly CdDeploymentStatus[] = ['QUEUED', 'STARTING'];

/** Whether this deployment is still moving — the only reason this page ever polls. */
export function isInFlight(status: CdDeploymentStatus): boolean {
  return IN_FLIGHT.includes(status);
}

/**
 * Which plane an application is deployed on: one tier's, or the platform's own.
 *
 * A `PLATFORM` application belongs to no environment — it is deployed once for the whole platform —
 * which is why the environment aggregate cannot list it and the flat listing exists.
 */
export type CdDeploymentTarget = 'ENVIRONMENT' | 'PLATFORM';

/**
 * The word that goes where an environment id goes and names the platform plane instead.
 *
 * It is the same stand-in the server puts at the front of a platform application's id
 * (`platform:qits-platform-idp`), and the deployment listing takes it as the value of the
 * `environmentId` filter. Unambiguous by construction: a real environment id is a random UUID.
 */
export const PLATFORM_PLANE = 'platform';

/**
 * One tracked application, flattened into one tier.
 *
 * `repoId` is displayed and never joined on: the applications in qits-deployments are seeded with
 * the git-host directory name, the same string `CiRun.repoId` carries, but this page's only join is
 * environment-to-project by name, so `repoId` is a column and nothing more.
 *
 * `environmentId`, `environmentName` and `branch` are the plane's mirror image: the first two are
 * null exactly when `target` is `PLATFORM`, and `branch` is set only then — an environment
 * application takes its branch from the environment it is linked into.
 */
export interface CdApplicationDto {
  readonly id: string;
  readonly repoId: string;
  readonly name: string;
  readonly environmentId: string | null;
  readonly environmentName: string | null;
  readonly target: CdDeploymentTarget;
  readonly availableOnEnv: boolean;
  readonly branch: string | null;
  readonly healthPath: string | null;
  readonly createdAt: string;
}

/**
 * An environment. `applications` is **null in the list endpoint** and populated only by the single
 * read — which is why expanding a project costs two requests rather than one.
 */
export interface CdEnvironmentDto {
  readonly id: string;
  readonly name: string;
  readonly branch: string;
  readonly network: string;
  readonly createdAt: string;
  readonly applications: readonly CdApplicationDto[] | null;
}

/**
 * One deployment of one application.
 *
 * `runId` is the ci run that produced the image, and it is the entire reason the commit cell can
 * link out of this application: qits-deployments has always *received* it on the build intake and
 * now records it. It is null for every row written before that column existed, so the link is drawn
 * per-row and its absence is not an error — it is history.
 *
 * `detail` is a clob: the reason an `IMAGE_MISSING` or `FAILED` row is what it is. A row expands in
 * place to show it, which is what stands in for a deployment detail route (Decision 4) —
 * qits-deployments has no deployment-by-id endpoint and this screen needs none.
 */
export interface CdDeploymentDto {
  readonly id: string;
  readonly applicationId: string;
  readonly applicationName: string;
  readonly commitSha: string;
  readonly status: CdDeploymentStatus;
  readonly containerName: string | null;
  readonly detail: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly runId: string | null;
}

/** cd's environment list envelope. Every environment, which is what makes orphans computable. */
export interface CdEnvironmentsResponse {
  readonly environments: readonly CdEnvironmentDto[];
}

/** cd's single-environment envelope — the one that carries `applications`. */
export interface CdEnvironmentResponse {
  readonly environment: CdEnvironmentDto;
}

/**
 * cd's flat application listing: every application on both planes, one entry per tier.
 *
 * The only listing that reaches a platform service at all. Reading the catalogue through the
 * environments leaves qits-platform-idp and qits-deployments itself out of it, because neither
 * belongs to a tier.
 */
export interface CdApplicationsResponse {
  readonly applications: readonly CdApplicationDto[];
}

/** cd's deployment list envelope. Sorted `createdAt desc, id desc` by the server. */
export interface CdDeploymentsResponse {
  readonly deployments: readonly CdDeploymentDto[];
}

/** A project's dns record, or the whole object is null when it registers no domain. */
export interface ProjectDnsRecordDto {
  readonly domain: string;
  readonly type: string;
  readonly value: string;
}

/**
 * A project.
 *
 * `slug` is the load-bearing field here and `name` is only a label: the project-to-environment edge
 * is `CdEnvironment.name === Project.slug`, by convention and by no column at all.
 */
export interface ProjectDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly dns: ProjectDnsRecordDto | null;
}

/** projects' list envelope: entries, each wrapping the thing it lists. */
export interface ProjectEntriesResponse {
  readonly entries: readonly { readonly project: ProjectDto }[];
}
