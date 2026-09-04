import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CdApi } from './cd-api';

/**
 * The paths and the envelopes, asserted once here so the page's spec can be about rendering.
 *
 * These are same-origin absolute paths on purpose — the SPA is served at `/platform-deployments/`
 * behind the gateway that also serves `/projects/api/…`, and that is what carries the session
 * cookie to both.
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
    http.expectOne('/platform-deployments/api/environments').flush({
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
    http.expectOne('/platform-deployments/api/environments/e1').flush({
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
    http.expectOne('/platform-deployments/api/environments/e1').flush({
      environment: { id: 'e1', name: 'qits', branch: 'main', network: 'n', applications: null },
    });
    await expect(applications).resolves.toEqual([]);
  });

  it('takes the platform services off the flat listing and leaves the tiered ones', async () => {
    // `GET /applications` is the only listing that reaches the platform plane, and it carries both
    // planes — so the client is where the tiered entries go, and the plane is what comes back.
    const applications = api.platformApplications();
    http.expectOne('/platform-deployments/api/applications').flush({
      applications: [
        {
          id: 'platform:qits-platform-idp',
          repoId: 'qits-platform-idp',
          name: 'qits-platform-idp',
          target: 'PLATFORM',
        },
        { id: 'e1:qits-stt', repoId: 'qits-stt', name: 'qits-stt', target: 'ENVIRONMENT' },
      ],
    });
    await expect(applications).resolves.toMatchObject([{ id: 'platform:qits-platform-idp' }]);
  });

  it('asks for the platform plane by name where an environment id goes', async () => {
    // `platform` is the stand-in the application ids already carry, and the one value of this
    // filter that is not an environment id. It cannot collide: an environment id is a UUID.
    const deployments = api.deployments('platform');
    http
      .expectOne(
        (candidate) =>
          candidate.url === '/platform-deployments/api/deployments' &&
          candidate.params.get('environmentId') === 'platform',
      )
      .flush({ deployments: [] });
    await expect(deployments).resolves.toEqual([]);
  });

  it('filters deployments by environment, which the service requires', async () => {
    const deployments = api.deployments('e1');
    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/platform-deployments/api/deployments' &&
        candidate.params.get('environmentId') === 'e1',
    );
    request.flush({ deployments: [] });
    await expect(deployments).resolves.toEqual([]);
  });

  it('posts a restart to the application, with no body to get wrong', async () => {
    const restarted = api.restart('e1:qits-ci');
    const request = http.expectOne(
      '/platform-deployments/api/applications/e1%3Aqits-ci/restart',
    );
    expect(request.request.method).toBe('POST');
    request.flush({});
    await expect(restarted).resolves.toBeUndefined();
  });

  it('posts a replica count to scale, and the count is the whole request', async () => {
    // Zero stops it and one starts it; the service refuses anything above one, because every
    // application on this platform is deployed as a single task.
    const stopped = api.scale('platform:qits-ci', 0);
    const request = http.expectOne(
      '/platform-deployments/api/applications/platform%3Aqits-ci/scale',
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ replicas: 0 });
    request.flush({});
    await expect(stopped).resolves.toBeUndefined();
  });

  it('escapes the colon in an application id rather than letting it reach the path raw', async () => {
    // The id is `<environmentId>:<name>` and it is one path segment, so the separator has to be
    // encoded — a raw colon in a segment is legal but is exactly the kind of thing a proxy in front
    // rewrites.
    const started = api.scale('e1:qits-ci', 1);
    http.expectOne('/platform-deployments/api/applications/e1%3Aqits-ci/scale').flush({});
    await expect(started).resolves.toBeUndefined();
  });

  it('rejects with the HttpErrorResponse, so callers can read the status', async () => {
    const deployments = api.deployments('nope');
    http
      .expectOne((candidate) => candidate.url === '/platform-deployments/api/deployments')
      .flush({ message: 'No such environment' }, { status: 404, statusText: 'Not Found' });
    await expect(deployments).rejects.toBeInstanceOf(HttpErrorResponse);
  });
});
