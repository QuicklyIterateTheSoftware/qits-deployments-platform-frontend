import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  provideQitsNavigationTree,
  provideQitsProjectList,
  provideQitsScope,
} from '@qits/ui-components';
import { routes } from '../app.routes';
import type { CdDeploymentRequestDto } from '../api/dto';

/**
 * The address a link from a release lands on, and the two answers it has.
 *
 * A hit **replaces** the URL rather than pushing one, so pressing back returns to whatever linked
 * here instead of to this page — which would resolve again and bounce the reader straight forward.
 *
 * A miss is a sentence and not a 404, because nothing existing is the ordinary answer for a library
 * or an SPA (they release versions that deploy nothing) and it is also what a release looks like in
 * the seconds before it reaches this service. Only waiting tells the two apart, so there is a retry.
 */
const PROJECTS = [{ id: 'p1', slug: 'qits', name: 'QITS' }];

describe('DeploymentRequestResolver', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const match = (id: string): CdDeploymentRequestDto => ({
    id,
    applicationName: 'qits-ci',
    version: '2026.903.113443',
    environmentId: 'e1',
    packageName: 'qits/qits-ci',
    repoId: 'repo ci',
    projectId: 'p1',
    qualityGate: 'MET',
    gateDetail: null,
    deploymentId: 'd1',
    createdAt: '2026-07-31T14:09:00Z',
    gateSettledAt: '2026-07-31T14:09:00Z',
    deploymentStatus: 'ACTIVE',
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationTree({ origin: 'https://dev.example.com', slots: {} }),
        provideQitsProjectList(PROJECTS),
        provideQitsScope('project'),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await harness.fixture.whenStable();
    }
  }

  /** A repository id with a space in it, so the round trip through the URL is under test too. */
  async function open(): Promise<void> {
    harness = await RouterTestingHarness.create(
      '/qits/deployment-requests/by-release/repo%20ci/2026.903.113443',
    );
    await settle();
  }

  function expectLookup() {
    return http.expectOne(
      (candidate) =>
        candidate.url === '/platform-deployments/api/deployment-requests' &&
        candidate.params.get('repoId') === 'repo ci' &&
        candidate.params.get('version') === '2026.903.113443',
    );
  }

  it('redirects to the newest matching request, replacing the address it arrived at', async () => {
    await open();
    // Newest first is the server's order, so the first match is the one a reader following a link
    // means — a version redeployed by hand writes a second request beside the first.
    expectLookup().flush({ deploymentRequests: [match('r2'), match('r1')] });
    await settle();

    expect(TestBed.inject(Router).url).toBe('/qits/deployment-requests/r2');
    // The detail page is now loading; this spec is about the hop, not about what it lands on.
    http.expectOne('/platform-deployments/api/deployment-requests/r2');
  });

  it('says so when the release deployed nothing, and offers to look again', async () => {
    await open();
    expectLookup().flush({ deploymentRequests: [] });
    await settle();

    const text = (harness.fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No deployment request exists for repo ci@2026.903.113443');
    expect(text).toContain('the release may deploy nothing');
    expect(text).toContain('Look again');
    // Nowhere to go: the address the reader arrived at is still the address.
    expect(TestBed.inject(Router).url).toBe(
      '/qits/deployment-requests/by-release/repo%20ci/2026.903.113443',
    );
  });
});
