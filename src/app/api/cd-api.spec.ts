import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CdApi } from './cd-api';

/**
 * The paths and the envelopes, asserted once here so the page's spec can be about rendering.
 *
 * These are same-origin absolute paths on purpose — the SPA is served at `/cd/` behind the gateway
 * that also serves `/projects/api/…`, and that is what carries the session cookie to both.
 */
describe('CdApi', () => {
  let api: CdApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(CdApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('unwraps the environment list', async () => {
    const environments = api.environments();
    http.expectOne('/cd/api/environments').flush({
      environments: [
        {
          id: 'e1',
          name: 'qits',
          branch: 'main',
          network: 'qits-net',
          createdAt: '2026-07-01T00:00:00Z',
          applications: null,
        },
      ],
    });
    await expect(environments).resolves.toMatchObject([{ id: 'e1', name: 'qits' }]);
  });

  it('reads one environment for its applications, through the singular envelope', async () => {
    const applications = api.applications('e1');
    http.expectOne('/cd/api/environments/e1').flush({
      environment: {
        id: 'e1',
        name: 'qits',
        branch: 'main',
        network: 'qits-net',
        createdAt: '2026-07-01T00:00:00Z',
        applications: [
          {
            id: 'a1',
            repoId: 'qits-ci',
            name: 'qits-ci',
            healthPath: '/ci/q/health',
            createdAt: '2026-07-01T00:00:00Z',
          },
        ],
      },
    });
    await expect(applications).resolves.toMatchObject([{ id: 'a1', repoId: 'qits-ci' }]);
  });

  it('reads a null applications array as none, not as a crash', async () => {
    // The *list* endpoint answers `applications: null` by design; a single read should not, but a
    // client that assumed so would throw on the one response shape the service already emits.
    const applications = api.applications('e1');
    http.expectOne('/cd/api/environments/e1').flush({
      environment: { id: 'e1', name: 'qits', branch: 'main', network: 'n', applications: null },
    });
    await expect(applications).resolves.toEqual([]);
  });

  it('filters deployments by environment, which the service requires', async () => {
    const deployments = api.deployments('e1');
    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/cd/api/deployments' && candidate.params.get('environmentId') === 'e1',
    );
    request.flush({ deployments: [] });
    await expect(deployments).resolves.toEqual([]);
  });

  it('rejects with the HttpErrorResponse, so callers can read the status', async () => {
    const deployments = api.deployments('nope');
    http
      .expectOne((candidate) => candidate.url === '/cd/api/deployments')
      .flush({ message: 'No such environment' }, { status: 404, statusText: 'Not Found' });
    await expect(deployments).rejects.toBeInstanceOf(HttpErrorResponse);
  });
});
