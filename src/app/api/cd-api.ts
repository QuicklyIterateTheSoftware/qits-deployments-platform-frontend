import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  CdApplicationDto,
  CdApplicationsResponse,
  CdDeploymentDto,
  CdDeploymentRequestDto,
  CdDeploymentRequestsResponse,
  CdDeploymentsResponse,
  CdEnvironmentDto,
  CdEnvironmentResponse,
  CdEnvironmentsResponse,
} from './dto';

/**
 * Everything this app reads from qits-deployments. There is nothing it writes: no redeploy, no
 * teardown, no environment management. The screen reports.
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
   * first row per `applicationId` in what comes back: one client-side pass over an already-sorted
   * list, and no extra request.
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
}
