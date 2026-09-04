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
 *
 * The last three are outcomes the server settles a row into *after* the deployment itself is over,
 * which is why none of them is in flight: `ROLLED_BACK` is an update that failed onto a predecessor
 * that kept serving, `SUPERSEDED` an interrupted attempt a newer deployment overtook, and `GONE` a
 * row that was serving until its container vanished under it.
 */
export type CdDeploymentStatus =
  | 'QUEUED'
  | 'STARTING'
  | 'ACTIVE'
  | 'IMAGE_MISSING'
  | 'ROLLED_BACK'
  | 'FAILED'
  | 'GONE'
  | 'DECOMMISSIONED'
  | 'SUPERSEDED';

/** The statuses a poll is waiting on. Anything else is settled. */
const IN_FLIGHT: readonly CdDeploymentStatus[] = ['QUEUED', 'STARTING'];

/** Whether this deployment is still moving — the only reason this page ever polls. */
export function isInFlight(status: CdDeploymentStatus): boolean {
  return IN_FLIGHT.includes(status);
}

/**
 * Which plane an application is deployed on: one tier's, or the platform's own.
 *
 * **It no longer says where the thing runs.** A platform service is deployed *into* the main
 * environment like everything else — the flag survives because it still decides three things the
 * server cares about (a bare wire alias, membership in every tier's network, and the `platform:`
 * key its rows are joined on) and one this screen cares about: it is worth saying, on the row, that
 * this service is not the tier's own.
 */
export type CdDeploymentTarget = 'ENVIRONMENT' | 'PLATFORM';

/**
 * One tracked application, flattened into one tier.
 *
 * `repoId` is displayed and never joined on: the applications in qits-deployments are seeded with
 * the git-host directory name, the same string `CiRun.repoId` carries, but this page's only join is
 * environment-to-project by name, so `repoId` is a column and nothing more.
 *
 * `environmentId` and `environmentName` are null exactly when `target` is `PLATFORM`, and they mean
 * **"carries no link"** rather than "runs nowhere": a platform service is deployed into the
 * designated environment and its deployment rows say so. The absence here is the catalogue's, which
 * is what makes a tier created tomorrow pick the service up.
 *
 * There is no `branch`. A release names a tag, so nothing in this catalogue has a deploy ref of its
 * own any more; the server dropped the field.
 */
export interface CdApplicationDto {
  readonly id: string;
  readonly repoId: string;
  readonly name: string;
  readonly environmentId: string | null;
  readonly environmentName: string | null;
  readonly target: CdDeploymentTarget;
  readonly availableOnEnv: boolean;
  readonly healthPath: string | null;
  readonly createdAt: string;
}

/**
 * An environment. `applications` is **null in the list endpoint** and populated only by the single
 * read — which is why expanding a project costs more than one request.
 *
 * There is no `branch`: a tier listened to `environment/<name>` while a green build was the deploy
 * trigger, and a release names a tag instead. V8 dropped the column.
 */
export interface CdEnvironmentDto {
  readonly id: string;
  readonly name: string;
  readonly network: string;
  /**
   * True on exactly one environment: the tier a release enters the platform at, and the tier the
   * platform plane is deployed into.
   *
   * It is what this page uses to decide **which environment the platform services are listed
   * under**. They carry no link into it — that is what being platform-tier means — so the flag is
   * the only thing that says where they run.
   */
  readonly platform: boolean;
  readonly createdAt: string;
  readonly applications: readonly CdApplicationDto[] | null;
}

/**
 * One deployment of one application.
 *
 * **`version` is the coordinate and `commitSha` is the commit behind it.** The version is the CalVer
 * stamp the release minted — the git tag, and the tag the image carries — and it is what a reader
 * identifies a deployment by. The sha is what that tag resolved to and is nullable: a repository
 * carrying no deployments.yml answers the spec read with a 404, which says nothing about where the
 * tag points. On rows written before releases became the trigger it is the other way round —
 * `version` is null and the sha was the whole coordinate — so both are drawn per-row and neither
 * absence is an error.
 *
 * `runId` is the ci run that produced the image, and it is the entire reason the commit cell can
 * link out of this application. A `SoftwareRelease` carries none, so only a manual replay supplies
 * one; the link is drawn per-row and its absence is not an error.
 *
 * `detail` is a clob: the reason an `IMAGE_MISSING` or `FAILED` row is what it is. A row expands in
 * place to show it, which is what stands in for a deployment detail route (Decision 4) —
 * qits-deployments has no deployment-by-id endpoint and this screen needs none.
 */
export interface CdDeploymentDto {
  readonly id: string;
  readonly applicationId: string;
  readonly applicationName: string;
  readonly version: string | null;
  readonly commitSha: string | null;
  readonly status: CdDeploymentStatus;
  readonly containerName: string | null;
  readonly detail: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly runId: string | null;
}

/**
 * What the quality gate said about a deployment request.
 *
 * `MET` is the only word written today — the gate is a placeholder that says yes to every released
 * version, because qits-ci's pipeline has already had its say. `UNMET` is modelled anyway, and this
 * screen renders it, because the day a real gate refuses something the refusal has to be visible
 * somewhere: there is no deployment row for a release that never happened.
 */
export type CdQualityGate = 'UNMET' | 'MET';

/**
 * One deployment request: **this version of this application was asked for here**.
 *
 * It is what a `SoftwareRelease` produces, and the deployment is what it produces in turn — request
 * → gate → deployment. `deploymentId` is the edge to the third step and is null when there is no
 * third step, which is the whole record of a release that shipped nothing; `gateDetail` says why.
 *
 * **The join key is `applicationName`, not an id.** A deployment carries a derived `applicationId`
 * because its row records which plane it is on; a request records no plane, so the server does not
 * derive one rather than guessing. A name is unique per tier, which is all this page needs.
 *
 * `gateSettledAt` is null while nothing has answered — a state today's placeholder skips, since it
 * answers in the transaction that writes the row.
 */
export interface CdDeploymentRequestDto {
  readonly id: string;
  readonly applicationName: string;
  readonly version: string;
  readonly environmentId: string | null;
  readonly packageName: string | null;
  readonly repoId: string | null;
  readonly projectId: string | null;
  readonly qualityGate: CdQualityGate;
  readonly gateDetail: string | null;
  readonly deploymentId: string | null;
  readonly createdAt: string;
  readonly gateSettledAt: string | null;
}

/**
 * Whether this request is still waiting on its gate — asked, and nothing has answered.
 *
 * Unreachable today and deliberately implemented anyway: it is the second non-terminal state of the
 * lifecycle this page follows, beside `QUEUED` and `STARTING`, and it is what the poll will have to
 * watch the moment a gate takes longer than a transaction. A settled gate that said no is *not* in
 * flight — it is an outcome, and polling it would never end.
 */
export function isPendingGate(request: CdDeploymentRequestDto): boolean {
  return request.qualityGate === 'UNMET' && request.gateSettledAt === null;
}

/** Whether the gate refused this request outright: it answered, and it queued nothing. */
export function isRefused(request: CdDeploymentRequestDto): boolean {
  return request.qualityGate === 'UNMET' && request.gateSettledAt !== null;
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

/** cd's deployment list envelope. Sorted newest-first by the server. */
export interface CdDeploymentsResponse {
  readonly deployments: readonly CdDeploymentDto[];
}

/**
 * cd's deployment-request envelope. Newest-first, and scoped to one environment like the deployment
 * listing — a platform service's requests are in the tier it deploys into, because that is the tier
 * its request names.
 */
export interface CdDeploymentRequestsResponse {
  readonly deploymentRequests: readonly CdDeploymentRequestDto[];
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
