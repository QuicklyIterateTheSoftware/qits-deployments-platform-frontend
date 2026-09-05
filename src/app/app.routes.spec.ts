import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  provideQitsNavigationTree,
  provideQitsProjectList,
  provideQitsScope,
} from '@qits/ui-components';
import { routes } from './app.routes';

/**
 * The URL grammar: every page is reachable at the root of this host and under a project slug, and
 * the slug does one visible thing on the table — it opens that project's row without a click.
 *
 * The page specs assert what each screen draws. This file asserts only that the addresses reach
 * them, that the scope seeds the expansion, and the one ordering that is easy to get wrong:
 * `by-release` is a literal segment declared before `:requestId`, and Angular matches in
 * declaration order, so the wrong order would send every release link to a request whose id is the
 * word `by-release`.
 */

const PROJECTS = [{ id: 'p1', slug: 'qits', name: 'QITS' }];

describe('routes', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationTree({ origin: 'https://dev.example.com', links: [] }),
        provideQitsProjectList(PROJECTS),
        provideQitsScope('project'),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  /** The page's own two flat lists. It reads projects itself; the chrome's list is a literal above. */
  async function flushRoots(harness: RouterTestingHarness): Promise<void> {
    http
      .expectOne('/projects/api/projects')
      .flush({ entries: PROJECTS.map((project) => ({ project: { ...project, dns: null } })) });
    http
      .expectOne('/platform-deployments/api/environments')
      .flush({ environments: [{ id: 'e1', name: 'qits', platform: false }] });
    for (let round = 0; round < 3; round += 1) {
      await harness.fixture.whenStable();
    }
  }

  it('draws the table at the root, expanding nothing', async () => {
    const harness = await RouterTestingHarness.create('/');
    await flushRoots(harness);

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-deployments-page'),
    ).not.toBeNull();
    // Nothing expanded means nothing fetched: the reader's clicks are the bound.
    http.verify();
  });

  it('draws the same table under a project slug, with that project already open', async () => {
    const harness = await RouterTestingHarness.create('/qits');
    await flushRoots(harness);

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-deployments-page'),
    ).not.toBeNull();
    // The scope seeded the expansion, so the plane behind the scoped project was read without a
    // click — the two requests an open row costs.
    http.expectOne('/platform-deployments/api/environments/e1').flush({
      environment: { id: 'e1', name: 'qits', platform: false, applications: [] },
    });
    http
      .expectOne(
        (request) =>
          request.url === '/platform-deployments/api/deployments' &&
          request.params.get('environmentId') === 'e1',
      )
      .flush({ deployments: [] });
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('.project-scope')?.textContent,
    ).toBe('QITS');
  });

  it('draws the requests page at the root, where it asks for nothing', async () => {
    // Outside a project there is no project id to read by, so the page makes no request at all —
    // which is why this route is reachable and still costs nothing.
    const harness = await RouterTestingHarness.create('/deployment-requests');
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-deployment-requests-page'),
    ).not.toBeNull();
    http.verify();
  });

  it('draws the requests page under a project slug, and reads that project', async () => {
    const harness = await RouterTestingHarness.create('/qits/deployment-requests');
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-deployment-requests-page'),
    ).not.toBeNull();
    http
      .expectOne(
        (request) =>
          request.url === '/platform-deployments/api/deployment-requests' &&
          request.params.get('projectId') === 'p1',
      )
      .flush({ deploymentRequests: [] });
  });

  it('gives one request a page of its own, by its id', async () => {
    const harness = await RouterTestingHarness.create('/qits/deployment-requests/r1');
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-deployment-request-page'),
    ).not.toBeNull();
    http.expectOne('/platform-deployments/api/deployment-requests/r1');
  });

  it('lets the by-release literal win over the id parameter beside it', async () => {
    // The ordering claim. With `:requestId` declared first this address would resolve as a request
    // whose id is `by-release`, and every link from a release would land on a 404 from the server.
    const harness = await RouterTestingHarness.create(
      '/qits/deployment-requests/by-release/repo-ci/2026.903.1',
    );
    await harness.fixture.whenStable();

    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-deployment-request-resolver'),
    ).not.toBeNull();
    http.expectOne(
      (request) =>
        request.url === '/platform-deployments/api/deployment-requests' &&
        request.params.get('repoId') === 'repo-ci' &&
        request.params.get('version') === '2026.903.1',
    );
  });
});
