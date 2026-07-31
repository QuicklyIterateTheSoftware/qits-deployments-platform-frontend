import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  CdApplicationDto,
  CdDeploymentDto,
  CdDeploymentsResponse,
  CdEnvironmentDto,
  CdEnvironmentResponse,
  CdEnvironmentsResponse,
} from './dto';

/**
 * Everything this app reads from qits-cd. There is nothing it writes: no redeploy, no teardown, no
 * environment management. The screen reports.
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
      this.http.get<CdEnvironmentsResponse>(`${this.base}/cd/api/environments`),
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
        `${this.base}/cd/api/environments/${encodeURIComponent(environmentId)}`,
      ),
    );
    return response.environment.applications ?? [];
  }

  /**
   * One environment's deployments, newest first, across all of its applications.
   *
   * `environmentId` is a required filter and the server answers 400 without it and 404 for an
   * environment it does not know — so this is never called speculatively. The "current deployment
   * per application" is the first row per `applicationId` in what comes back: one client-side pass
   * over an already-sorted list, and no third request.
   */
  async deployments(environmentId: string): Promise<readonly CdDeploymentDto[]> {
    const params = new HttpParams().set('environmentId', environmentId);
    const response = await firstValueFrom(
      this.http.get<CdDeploymentsResponse>(`${this.base}/cd/api/deployments`, { params }),
    );
    return response.deployments;
  }
}
