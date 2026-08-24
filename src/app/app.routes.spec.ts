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
 * The URL grammar: the one page is reachable at the root of this host and under a project slug, and
 * the slug does one visible thing — it opens that project's row without a click.
 *
 * `deployments-page.spec.ts` asserts what the table draws. This file asserts only that the address
 * reaches it and that the scope seeds the expansion.
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
});
