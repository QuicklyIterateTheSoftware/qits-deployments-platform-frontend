import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  CdApplicationDto,
  CdApplicationsResponse,
  CdDeploymentDto,
  CdDeploymentRequestDetailResponse,
  CdDeploymentRequestDto,
  CdDeploymentRequestsResponse,
  CdDeploymentsResponse,
  CdEnvironmentDto,
  CdEnvironmentResponse,
  CdEnvironmentsResponse,
} from './dto';

/**
 * Everything this app reads from qits-deployments, and the two things it writes.
 *
 * **The two writes are operations on a running application, not on the catalogue**: stop it, start
 * it again, bounce it. There is still no redeploy, no teardown and no environment management here —
 * what a repository deploys is derived from its own `deployments.yml` on every green build, and this
 * screen has no business creating any of it. What it gained is the lever an operator reached for on
 * the day qits-ci wedged: the alternative was re-firing a same-sha push and waiting a quarter of an
 * hour for a rebuild that would replace the container.
 *
 * Both answer **202**: qits-deployments runs every orchestrator call on one worker, behind whatever
 * is deploying, so the answer is "queued" and the deployment list is where the result appears. The
 * page therefore re-reads the plane after each call rather than believing the response.
 *
 * `HttpClient` on the fetch backend rather than bare `fetch()`, for two reasons that both cash out
 * elsewhere: `HttpTestingController` is the only request-mocking story Angular ships and the specs
 * for this page are mostly "given this response, render that", and `withFetch()` routes through
 * `window.fetch`, which is what the platform's OTel browser instrumentation hooks. The observable
 * is unwrapped with `firstValueFrom` immediately — these are one-shot reads, and a promise is what
 * the page's `async` methods want.
 *
 * Angular 21.2 also ships `httpResource()`, which would suit lazy expansion well. It is still
 * marked `@experimental 19.2` in the pinned `@angular/common`, so it is not used here; this service
 * is the seam that makes adopting it a change inside the page rather than a rewrite.
 */
@Injectable({ providedIn: 'root' })
export class CdApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /**
   * Every environment, newest first, **without** its applications.
   *
   * This unfiltered listing is what makes both orphan directions computable in the browser: the
   * environments no project's slug matches are a set difference against a list that is already
   * complete. cd needs no service gap for that honesty, which is exactly the asymmetry with ci,
   * whose run listing takes a mandatory repository filter.
   */
  async environments(): Promise<readonly CdEnvironmentDto[]> {
    const response = await firstValueFrom(
      this.http.get<CdEnvironmentsResponse>(`${this.base}/platform-deployments/api/environments`),
    );
    return response.environments;
  }

  /**
   * One environment's tracked applications.
   *
   * A second request rather than a field on the listing, because the listing genuinely answers
   * `applications: null` by design. The applications are read from *here* and never inferred from
   * the deployment rows — an application that has never been deployed has no row to be inferred
   * from, and dropping it would hide the most interesting line on the table.
   */
  async applications(environmentId: string): Promise<readonly CdApplicationDto[]> {
    const response = await firstValueFrom(
      this.http.get<CdEnvironmentResponse>(
        `${this.base}/platform-deployments/api/environments/${encodeURIComponent(environmentId)}`,
      ),
    );
    return response.environment.applications ?? [];
  }

  /**
   * Every platform service, off the flat listing that spans both planes.
   *
   * **A platform service carries no link into an environment, and this is the only listing that
   * reaches one.** It runs in the designated environment — its deployment rows say so — but the
   * catalogue deliberately records no link, which is what makes a tier created tomorrow pick it up.
   * So the environment aggregate cannot list qits-platform-idp, qits-ci or this component's own row,
   * and the page merges them in from here.
   *
   * **The filter is here rather than on the page**: the listing carries both planes and the server
   * offers no `?target=`, so somewhere has to drop the tiered entries — and doing it here means the
   * page merges one list into another rather than partitioning one.
   */
  async platformApplications(): Promise<readonly CdApplicationDto[]> {
    const response = await firstValueFrom(
      this.http.get<CdApplicationsResponse>(`${this.base}/platform-deployments/api/applications`),
    );
    return response.applications.filter((application) => application.target === 'PLATFORM');
  }

  /**
   * One environment's deployments, newest first, across all of its applications.
   *
   * **The platform services' rows are in here too**, because a platform service is deployed into the
   * designated environment and its rows name that tier. Their `applicationId` still reads
   * `platform:<name>`, which is the same key the flat catalogue gives them — the join holds across
   * the merge.
   *
   * It is a required filter and the server answers 400 without it and 404 for an environment it does
   * not know, so this is never called speculatively. The "current deployment per application" is the
   * NEWEST row per `applicationId` in what comes back — one client-side pass, no extra request, and
   * `DeploymentTable.newestFirst` performs the ordering rather than inheriting the one this method
   * happens to return. This comment used to say "the first row", which was true only while a single
   * already-sorted listing fed the table; it is not a contract a reader here can check, and reading
   * it as one is what showed a stale `FAILED` attempt as the state of an `ACTIVE` application.
   */
  async deployments(environmentId: string): Promise<readonly CdDeploymentDto[]> {
    const params = new HttpParams().set('environmentId', environmentId);
    const response = await firstValueFrom(
      this.http.get<CdDeploymentsResponse>(`${this.base}/platform-deployments/api/deployments`, {
        params,
      }),
    );
    return response.deployments;
  }

  /**
   * Set how many tasks of this application run: `0` stops it, `1` starts it again.
   *
   * The id is the same derived key the two listings are joined on (`<environmentId>:<name>`, or
   * `platform:<name>`), which is why this takes no separate plane argument — the key already says
   * which one.
   *
   * Scaling to zero keeps the service and everything about it, so starting it again is the same
   * deployment coming back rather than a new one. That is the entire reason this is a scale and not
   * a redeploy.
   */
  async scale(applicationId: string, replicas: number): Promise<void> {
    await firstValueFrom(
      this.http.post(
        `${this.base}/platform-deployments/api/applications/${encodeURIComponent(applicationId)}/scale`,
        { replicas },
      ),
    );
  }

  /**
   * Replace the tasks running under this application's name, unchanged — the bounce.
   *
   * No deployment row is created and none is re-stated: the sha, the image and the history stay as
   * the deployment left them, and the row gains a line saying who bounced it. It is the recovery for
   * an application that is up, healthy to its probe, and wedged behind it.
   */
  async restart(applicationId: string): Promise<void> {
    await firstValueFrom(
      this.http.post(
        `${this.base}/platform-deployments/api/applications/${encodeURIComponent(applicationId)}/restart`,
        {},
      ),
    );
  }

  /**
   * One environment's deployment requests, newest first — what was asked for here, and what the
   * quality gate said about it.
   *
   * A separate resource rather than a field on the deployments, and that is the point of it: a
   * request the gate refused produced **no deployment at all**, so it cannot be a property of one.
   * This is the only listing in which a release that shipped nothing is visible.
   *
   * The same required `environmentId` filter, with the same 400 and 404. There is no `platform`
   * value here — a request records no plane, and a platform service's request names the tier it
   * deploys into, so it comes back in that tier's listing.
   */
  async deploymentRequests(environmentId: string): Promise<readonly CdDeploymentRequestDto[]> {
    const params = new HttpParams().set('environmentId', environmentId);
    const response = await firstValueFrom(
      this.http.get<CdDeploymentRequestsResponse>(
        `${this.base}/platform-deployments/api/deployment-requests`,
        { params },
      ),
    );
    return response.deploymentRequests;
  }

  /**
   * One project's deployment requests: everything still moving, and the ten most recent that are
   * not.
   *
   * **The cap is the server's and this method does not restate it.** A project that has been
   * releasing for a year holds thousands of settled requests, and a client that asked for them in
   * order to show ten would be downloading the year and throwing it away. What is never capped is
   * the pending half — a release the platform has not finished with must not be the row a limit
   * dropped.
   *
   * It is scoped by project and **not** by tier, which is why it exists beside the listing above: a
   * project's releases enter at whichever environment the platform designates, and the designation
   * moves, so a tier-scoped read would silently lose everything asked for before it did.
   *
   * An unknown project answers `200 []` rather than 404, deliberately: qits-deployments holds no
   * project rows, so "no request here carries that project" is the whole of what it can say.
   */
  async projectDeploymentRequests(projectId: string): Promise<readonly CdDeploymentRequestDto[]> {
    const params = new HttpParams().set('projectId', projectId);
    const response = await firstValueFrom(
      this.http.get<CdDeploymentRequestsResponse>(
        `${this.base}/platform-deployments/api/deployment-requests`,
        { params },
      ),
    );
    return response.deploymentRequests;
  }

  /**
   * One deployment request, with the deployment it produced.
   *
   * The deployment travels inside this answer instead of behind a second call, because there is no
   * deployment-by-id endpoint to make one against — the deployments listing is tier-scoped, and
   * qits-deployments declined to open a second door onto that table for one screen. `deployment` is
   * null for a request that queued nothing.
   */
  async deploymentRequest(id: string): Promise<CdDeploymentRequestDetailResponse> {
    return await firstValueFrom(
      this.http.get<CdDeploymentRequestDetailResponse>(
        `${this.base}/platform-deployments/api/deployment-requests/${encodeURIComponent(id)}`,
      ),
    );
  }

  /**
   * Every deployment request written for one released version of one repository, newest first.
   *
   * The join followed the other way: a link from a release elsewhere on the platform knows a
   * repository and a version and nothing about the name this platform deploys under — which may be
   * the repository's, or the `application:` its spec overrides with, and only qits-deployments
   * knows which. **Both halves are required**, and the server answers 400 for either alone.
   *
   * An empty answer is ordinary rather than an error: a library or an SPA releases a version that
   * deploys nothing at all.
   */
  async deploymentRequestsByRelease(
    repoId: string,
    version: string,
  ): Promise<readonly CdDeploymentRequestDto[]> {
    const params = new HttpParams().set('repoId', repoId).set('version', version);
    const response = await firstValueFrom(
      this.http.get<CdDeploymentRequestsResponse>(
        `${this.base}/platform-deployments/api/deployment-requests`,
        { params },
      ),
    );
    return response.deploymentRequests;
  }
}
