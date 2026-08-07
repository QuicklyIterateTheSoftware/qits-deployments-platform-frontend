import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import type { CdApplicationDto, CdDeploymentDto, CdEnvironmentDto, ProjectDto } from '../api/dto';
import { POLL_INTERVAL_MS } from './deployments-page';

/**
 * The states table, one `it` at a time, driven through `HttpTestingController`.
 *
 * Three assertions carry more than their length. **Both orphan directions**, because a project with
 * no environment and an environment with no project are the two ways this page's one join can be
 * false, and hiding either would turn a convention into a claim. **The collapsed node that makes no
 * request**, because an eager fan-out looks identical on screen and simply costs a request per
 * environment. And **the poll that stops**, because a poll that does not stop is invisible in
 * review: the table looks right and the tab re-reads a settled deployment list forever.
 */
describe('DeploymentsPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const project = (id: string, name: string, slug: string): ProjectDto => ({
    id,
    name,
    slug,
    description: null,
    dns: null,
  });

  const environment = (id: string, name: string): CdEnvironmentDto => ({
    id,
    name,
    branch: 'main',
    network: 'qits-net',
    createdAt: '2026-07-01T00:00:00Z',
    applications: null,
  });

  const application = (
    id: string,
    name: string,
    over: Partial<CdApplicationDto> = {},
  ): CdApplicationDto => ({
    id,
    repoId: name,
    name,
    environmentId: 'e1',
    environmentName: 'qits',
    target: 'ENVIRONMENT',
    availableOnEnv: false,
    branch: null,
    healthPath: null,
    createdAt: '2026-07-01T00:00:00Z',
    ...over,
  });

  /** A platform service, as the flat listing carries it: no tier, and a branch of its own. */
  const platformApplication = (name: string): CdApplicationDto =>
    application(`platform:${name}`, name, {
      environmentId: null,
      environmentName: null,
      target: 'PLATFORM',
      branch: 'platform/main',
    });

  const deployment = (
    id: string,
    applicationId: string,
    over: Partial<CdDeploymentDto> = {},
  ): CdDeploymentDto => ({
    id,
    applicationId,
    applicationName: applicationId,
    commitSha: '9f2c1ab3d4e5f6',
    status: 'ACTIVE',
    containerName: 'qits-ci-9f2c1ab',
    detail: null,
    createdAt: '2026-07-31T14:09:04Z',
    finishedAt: '2026-07-31T14:09:45Z',
    runId: null,
    ...over,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  /** Mount the page at a URL. Doing it per test is what lets a deep link be one of them. */
  async function open(url = '/'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  function labels(selector: string): (string | null)[] {
    return Array.from(page().querySelectorAll(selector)).map((node) => node.textContent);
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(page().querySelectorAll('button'));
  }

  async function click(label: string): Promise<void> {
    const target = buttons().find((button) => (button.textContent ?? '').includes(label));
    expect(target, `no button reading "${label}"`).toBeTruthy();
    target?.click();
    await settle();
  }

  /** Let the flushed responses land, their signals write, and change detection run. */
  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round += 1) {
      await harness.fixture.whenStable();
    }
  }

  /**
   * `document.hidden` is a getter on the prototype and jsdom does not let a test assign it, so the
   * visibility a spec needs is defined onto the document itself.
   */
  function setHidden(hidden: boolean): void {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  }

  /**
   * Only `setInterval` is faked, and that is deliberate. Angular's zoneless change-detection
   * scheduler races a `setTimeout` against a `requestAnimationFrame`, so faking those would freeze
   * rendering itself and `whenStable()` would never resolve. The poll is the only thing this suite
   * needs control of.
   */
  function useIntervalFakes(): void {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  }

  async function tick(millis: number): Promise<void> {
    vi.advanceTimersByTime(millis);
    await settle();
  }

  function flushProjects(projects: readonly ProjectDto[]): void {
    http
      .expectOne('/projects/api/projects')
      .flush({ entries: projects.map((entry) => ({ project: entry })) });
  }

  function flushEnvironments(environments: readonly CdEnvironmentDto[]): void {
    http.expectOne('/platform-deployments/api/environments').flush({ environments });
  }

  async function flushRoots(
    projects: readonly ProjectDto[],
    environments: readonly CdEnvironmentDto[],
  ): Promise<void> {
    flushProjects(projects);
    flushEnvironments(environments);
    await settle();
  }

  function expectDeployments(planeId: string) {
    return http.expectOne(
      (request) =>
        request.url === '/platform-deployments/api/deployments' &&
        request.params.get('environmentId') === planeId,
    );
  }

  /** The two requests the platform bucket costs — the flat catalogue, and the plane's own rows. */
  async function flushPlatform(
    applications: readonly CdApplicationDto[],
    deployments: readonly CdDeploymentDto[],
  ): Promise<void> {
    http.expectOne('/platform-deployments/api/applications').flush({ applications });
    expectDeployments('platform').flush({ deployments });
    await settle();
  }

  /** The two requests an expansion costs, answered together. */
  async function flushEnvironment(
    environmentId: string,
    applications: readonly CdApplicationDto[],
    deployments: readonly CdDeploymentDto[],
  ): Promise<void> {
    http.expectOne(`/platform-deployments/api/environments/${environmentId}`).flush({
      environment: { ...environment(environmentId, environmentId), applications },
    });
    expectDeployments(environmentId).flush({ deployments });
    await settle();
  }

  it('loads two flat lists, and asks nothing about a project nobody expanded', async () => {
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    expect(text()).toContain('1 project · 1 environment · 0 unmatched.');
    // No environment read and no deployment list: the user's clicks are the bound.
    http.verify();
  });

  it('matches a project to its environment by slug, and draws the table on expansion', async () => {
    await open();
    await flushRoots([project('p1', 'qits platform', 'qits')], [environment('e1', 'qits')]);

    // The match is announced on the row, so the convention is visible rather than implied.
    expect(text()).toContain('environment "qits" · main · network qits-net');

    await click('qits platform');
    expect(page().querySelector('.async-loading')).not.toBeNull();

    await flushEnvironment(
      'e1',
      [application('a1', 'qits-ci')],
      [deployment('d1', 'a1', { commitSha: '9f2c1abcdef' })],
    );

    expect(text()).toContain('qits-ci');
    expect(text()).toContain('ACTIVE');
    expect(text()).toContain('9f2c1ab');
    expect(text()).toContain('qits-ci-9f2c1ab');
    expect(text()).toContain('31 Jul 14:09');
  });

  it('says so when a project’s slug names no environment — the notifier may simply have failed', async () => {
    await open();
    await flushRoots([project('p2', 'scratch', 'scratch')], [environment('e1', 'qits')]);

    await click('scratch');

    expect(text()).toContain('No environment named "scratch" exists in qits-platform-deployments.');
    // Nothing to fetch for an environment that does not exist.
    http.verify();
  });

  it('puts an environment no project’s slug names into a bucket of its own', async () => {
    await open();
    await flushRoots(
      [project('p1', 'qits', 'qits')],
      [environment('e1', 'qits'), environment('e9', 'epic-spike-42')],
    );

    expect(text()).toContain('1 project · 2 environments · 1 unmatched.');
    expect(labels('.bucket .label')).toContain('epic-spike-42');
    // The matched one is under its project and not in the bucket as well.
    expect(labels('.bucket .label')).not.toContain('qits');
  });

  it('draws the bucket even when it is empty, because “0 environments” is information', async () => {
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    expect(text()).toContain('Environments matching no project');
    expect(text()).toContain('0 environments');
    expect(text()).toContain("Every environment is named by a project's slug.");
  });

  it('expands an unmatched environment to the same table, straight from the bucket', async () => {
    await open();
    await flushRoots([], [environment('e9', 'epic-spike-42')]);

    await click('epic-spike-42');
    await flushEnvironment('e9', [application('a9', 'qits-spike')], [deployment('d9', 'a9')]);

    expect(text()).toContain('qits-spike');
    expect(text()).toContain('ACTIVE');
  });

  it('names the platform plane on arrival, asks nothing about it, and draws it on a click', async () => {
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    // The regression this holds: read through the projects alone, this page showed the tiers and
    // gave no sign the platform's own applications existed at all.
    expect(text()).toContain('Platform services');
    http.verify();

    await click('Platform services');
    await flushPlatform(
      [platformApplication('qits-idp'), platformApplication('qits-ci')],
      [deployment('dp1', 'platform:qits-idp', { applicationName: 'qits-idp' })],
    );

    expect(text()).toContain('2 services');
    expect(text()).toContain('qits-idp');
    expect(text()).toContain('ACTIVE');
    // And the never-deployed claim holds on this plane too, for the same reason.
    expect(text()).toContain('qits-ci');
    expect(text()).toContain('never deployed');
  });

  it('keeps the tiered entries of the flat catalogue out of the platform bucket', async () => {
    await open();
    await flushRoots([], [environment('e1', 'qits')]);

    await click('Platform services');
    await flushPlatform(
      [platformApplication('qits-idp'), application('e1:qits-stt', 'qits-stt')],
      [],
    );

    // `GET /applications` spans both planes — it is the listing that reaches the platform, not a
    // platform listing. A tier's application belongs under its project.
    expect(text()).toContain('1 service');
    expect(text()).toContain('qits-idp');
    expect(text()).not.toContain('qits-stt');
  });

  it('draws an application that has never been deployed, because the row comes from the environment', async () => {
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment('e1', [application('a1', 'qits-dns')], []);

    // Derived from the deployment list it would not exist at all, which is the whole point.
    expect(text()).toContain('qits-dns');
    expect(text()).toContain('never deployed');
  });

  it('says so when an environment tracks no applications', async () => {
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment('e1', [], []);

    expect(text()).toContain('This environment tracks no applications.');
  });

  it('shows the newest deployment per application and keeps the rest behind the row', async () => {
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-ci')],
      [
        deployment('d2', 'a1', { commitSha: 'aa71903ff', createdAt: '2026-07-31T15:21:00Z' }),
        deployment('d1', 'a1', {
          commitSha: '1de0447aa',
          status: 'DECOMMISSIONED',
          createdAt: '2026-07-30T22:41:00Z',
        }),
      ],
    );

    expect(text()).toContain('aa71903');
    // History is behind the affordance, not beside the current row.
    expect(text()).not.toContain('1de0447');
    expect(text()).not.toContain('DECOMMISSIONED');

    await click('qits-ci');

    expect(text()).toContain('1 earlier deployment');
    expect(text()).toContain('1de0447');
    expect(text()).toContain('DECOMMISSIONED');
    // The expansion is also where the deployment says what happened to it.
    expect(text()).toContain('31 Jul 2026 15:21:00Z');
  });

  it('shows the detail clob in the expanded row, which is what stands in for a detail route', async () => {
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-stt')],
      [
        deployment('d1', 'a1', {
          status: 'IMAGE_MISSING',
          containerName: null,
          detail: 'manifest unknown for qits/qits-stt:77c0e13',
        }),
      ],
    );

    expect(text()).toContain('IMAGE_MISSING');
    expect(text()).not.toContain('manifest unknown');

    await click('qits-stt');
    expect(page().querySelector('.detail')?.textContent).toContain('manifest unknown');
  });

  it('links a deployment to the ci run that built it, and only when it has one', async () => {
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-ci'), application('a2', 'qits-cd')],
      [
        deployment('d1', 'a1', { runId: 'da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61' }),
        deployment('d2', 'a2'),
      ],
    );

    // A plain href across applications: /ci/ is another SPA behind the same gateway, and this
    // app's router owns nothing outside /platform-deployments/.
    const link = page().querySelector<HTMLAnchorElement>(
      'a[href="/ci/runs/da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61"]',
    );
    expect(link).not.toBeNull();
    expect(link?.getAttribute('title')).toContain('9f2c1ab3d4e5f6');

    // The row with no runId — every row written before cd recorded it — is a plain sha.
    expect(page().querySelectorAll('a[href^="/ci/runs/"]')).toHaveLength(1);
    expect(text()).toContain('9f2c1ab');
  });

  it('collapses a failed expansion to one retry on that row, and retries it in place', async () => {
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    http
      .expectOne('/platform-deployments/api/environments/e1')
      .flush(null, { status: 503, statusText: 'Service Unavailable' });
    expectDeployments('e1').flush(null, { status: 503, statusText: 'Service Unavailable' });
    await settle();

    // One failure, not two: the table needs both lists, so it is one thing that did not load.
    expect(text()).toContain('Could not load deployments — 503');
    expect(page().querySelectorAll('.async-error')).toHaveLength(1);

    await click('Retry');
    await flushEnvironment('e1', [application('a1', 'qits-ci')], [deployment('d1', 'a1')]);

    expect(text()).not.toContain('Could not load deployments');
    expect(text()).toContain('qits-ci');
  });

  it('shows a full-page error only when both roots fail', async () => {
    await open();
    http.expectOne('/projects/api/projects').flush(null, { status: 500, statusText: 'Error' });
    http
      .expectOne('/platform-deployments/api/environments')
      .flush(null, { status: 500, statusText: 'Error' });
    await settle();

    expect(text()).toContain('Could not load the page');

    await click('Retry');
    await flushRoots([], []);

    expect(text()).not.toContain('Could not load the page');
  });

  it('renders every environment as unmatched behind a banner when projects are down', async () => {
    await open();
    http.expectOne('/projects/api/projects').flush(null, { status: 503, statusText: 'Down' });
    flushEnvironments([environment('e1', 'qits')]);
    await settle();

    expect(text()).toContain('Projects are unavailable');
    expect(text()).not.toContain('Could not load the page');
    expect(labels('.bucket .label')).toContain('qits');
  });

  it('never claims an environment is absent when the deployments service is down', async () => {
    await open();
    flushProjects([project('p1', 'qits', 'qits')]);
    http
      .expectOne('/platform-deployments/api/environments')
      .flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(text()).toContain('Environments are unavailable');
    expect(text()).toContain('qits');

    await click('qits');

    // The lie this page must not tell: "no environment named qits exists" when nothing was asked.
    expect(text()).not.toContain('exists in qits-platform-deployments');
    expect(text()).toContain('Could not load environments — 503');
  });

  it('does not poll a table where everything has settled', async () => {
    useIntervalFakes();
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment('e1', [application('a1', 'qits-ci')], [deployment('d1', 'a1')]);

    await tick(POLL_INTERVAL_MS * 4);
    http.verify();
  });

  it('polls every five seconds while a deployment is in flight, and stops when it lands', async () => {
    useIntervalFakes();
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-ci')],
      [deployment('d1', 'a1', { status: 'STARTING', finishedAt: null })],
    );

    expect(text()).toContain('following 1 plane');

    await tick(POLL_INTERVAL_MS);
    // Only the deployments are re-read; what an environment tracks does not change mid-start.
    expectDeployments('e1').flush({
      deployments: [deployment('d1', 'a1', { status: 'STARTING', finishedAt: null })],
    });
    await settle();

    await tick(POLL_INTERVAL_MS);
    expectDeployments('e1').flush({ deployments: [deployment('d1', 'a1', { status: 'ACTIVE' })] });
    await settle();

    expect(text()).toContain('ACTIVE');
    expect(text()).not.toContain('following');

    await tick(POLL_INTERVAL_MS * 4);
    http.verify();
  });

  it('pauses while the tab is hidden and reads once when it comes back', async () => {
    useIntervalFakes();
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-ci')],
      [deployment('d1', 'a1', { status: 'QUEUED', finishedAt: null })],
    );

    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    await tick(POLL_INTERVAL_MS * 3);
    http.verify(); // a hidden tab polls nothing

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expectDeployments('e1').flush({ deployments: [deployment('d1', 'a1', { status: 'ACTIVE' })] });
    await settle();

    expect(text()).toContain('ACTIVE');
  });

  it('keeps the last good table on screen when a poll fails, and says so', async () => {
    useIntervalFakes();
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-ci')],
      [deployment('d1', 'a1', { status: 'STARTING', finishedAt: null })],
    );

    await tick(POLL_INTERVAL_MS);
    expectDeployments('e1').flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(text()).toContain('The last refresh failed — 503');
    expect(text()).toContain('STARTING');
  });

  it('carries expansion in the URL, so it is bookmarkable and pressing back collapses it', async () => {
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment('e1', [], []);

    const router = TestBed.inject(Router);
    expect(router.url).toContain('project=p1');

    await click('qits');
    expect(router.url).not.toContain('project=p1');
  });

  it('loads what a deep-linked URL says is open, and nothing else', async () => {
    await open('/?project=p1');
    await flushRoots(
      [project('p1', 'qits', 'qits'), project('p2', 'website', 'website')],
      [environment('e1', 'qits'), environment('e2', 'website')],
    );

    await flushEnvironment('e1', [application('a1', 'qits-ci')], [deployment('d1', 'a1')]);

    expect(text()).toContain('qits-ci');
    // The second project is on screen and was never asked about.
    expect(text()).toContain('website');
    http.verify();
  });
});
