import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationTree, type QitsNavigation } from '@qits/ui-components';
import { routes } from '../app.routes';
import type {
  CdApplicationDto,
  CdDeploymentDto,
  CdDeploymentRequestDto,
  CdEnvironmentDto,
  ProjectDto,
} from '../api/dto';
import { POLL_INTERVAL_MS } from './deployments-page';

/**
 * The states table, one `it` at a time, driven through `HttpTestingController`.
 *
 * Four assertions carry more than their length. **Both orphan directions**, because a project with
 * no environment and an environment with no project are the two ways this page's one join can be
 * false, and hiding either would turn a convention into a claim. **The collapsed node that makes no
 * request**, because an eager fan-out looks identical on screen and simply costs a request per
 * environment. **The poll that stops**, because a poll that does not stop is invisible in review:
 * the table looks right and the tab re-reads a settled deployment list forever. And **the platform
 * service listed under its environment**, because the section that used to hold it was the visible
 * half of a model in which it belonged to no environment at all — one that is no longer true.
 */
/** Where the environment itself is served, as the navigation states it. */
const ENVIRONMENT_ORIGIN = 'https://dev.example.com';

/** Where qits-ci is served: its own host, which is the only address a run link can have. */
const CI_ORIGIN = 'https://ci.dev.example.com';

/** The platform as the edge states it, with qits-ci on its host or named nowhere at all. */
function navigation(ci: boolean): QitsNavigation {
  return {
    origin: ENVIRONMENT_ORIGIN,
    slots: {
      'services.details': ci
        ? [{ app: 'qits-ci', label: 'CI', host: 'ci', origin: CI_ORIGIN, path: '/ci' }]
        : [],
    },
  };
}

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

  const environment = (
    id: string,
    name: string,
    over: Partial<CdEnvironmentDto> = {},
  ): CdEnvironmentDto => ({
    id,
    name,
    network: 'qits-net',
    platform: false,
    createdAt: '2026-07-01T00:00:00Z',
    applications: null,
    ...over,
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
    healthPath: null,
    createdAt: '2026-07-01T00:00:00Z',
    ...over,
  });

  /**
   * A platform service, as the flat listing carries it: **no link into any environment**, which is
   * not the same as no environment. It is deployed into the designated one, and its id still reads
   * `platform:<name>` — the key its deployment rows are derived under, so the join survives the
   * merge into that environment's table.
   */
  const platformApplication = (name: string): CdApplicationDto =>
    application(`platform:${name}`, name, {
      environmentId: null,
      environmentName: null,
      target: 'PLATFORM',
    });

  const deployment = (
    id: string,
    applicationId: string,
    over: Partial<CdDeploymentDto> = {},
  ): CdDeploymentDto => ({
    id,
    applicationId,
    applicationName: applicationId,
    version: '2026.903.113443',
    commitSha: '9f2c1ab3d4e5f6',
    status: 'ACTIVE',
    containerName: 'qits-ci-9f2c1ab',
    detail: null,
    createdAt: '2026-07-31T14:09:04Z',
    finishedAt: '2026-07-31T14:09:45Z',
    runId: null,
    ...over,
  });

  /** One deployment request: a version asked for, and what the gate said. Met, unless told else. */
  const request = (
    id: string,
    applicationName: string,
    over: Partial<CdDeploymentRequestDto> = {},
  ): CdDeploymentRequestDto => ({
    id,
    applicationName,
    version: '2026.903.113443',
    environmentId: 'e1',
    packageName: `qits/${applicationName}`,
    repoId: applicationName,
    projectId: 'qits',
    qualityGate: 'MET',
    gateDetail: null,
    deploymentId: null,
    createdAt: '2026-07-31T14:09:00Z',
    gateSettledAt: '2026-07-31T14:09:00Z',
    // The status of the deployment this request points at, joined by the server. This table draws
    // the deployment's own row for that, so the field is here only because the wire carries it.
    deploymentStatus: null,
    ...over,
  });

  /** The platform's own navigation, from a literal so nothing is fetched. */
  function configure(tree: QitsNavigation): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationTree(tree),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  }

  beforeEach(() => configure(navigation(true)));

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

  /**
   * Let the flushed responses land, their signals write, and change detection run.
   *
   * A real `setTimeout(0)` before each stability check, and that is load-bearing rather than
   * belt-and-braces: a macrotask runs only once the microtask queue is empty, so it drains a promise
   * chain of any depth. Counting `whenStable()` rounds drains a *fixed* number of microtask ticks
   * instead, and it silently stopped being enough the moment the poll started awaiting two reads
   * inside the one it already awaited. Only `setInterval` is faked, so this timer is the real one.
   */
  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
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

  function expectDeployments(environmentId: string) {
    return http.expectOne(
      (candidate) =>
        candidate.url === '/platform-deployments/api/deployments' &&
        candidate.params.get('environmentId') === environmentId,
    );
  }

  function expectRequests(environmentId: string) {
    return http.expectOne(
      (candidate) =>
        candidate.url === '/platform-deployments/api/deployment-requests' &&
        candidate.params.get('environmentId') === environmentId,
    );
  }

  /**
   * The three requests an expansion costs, answered together: the environment's own catalogue, its
   * deployments, and the versions asked for in it.
   *
   * `platformApplications` is the fourth, and only the designated environment costs it — a platform
   * service carries no link, so the aggregate cannot list it and the flat catalogue is where it
   * comes from. Passing it here says "this environment is the one the plane deploys into".
   */
  async function flushEnvironment(
    environmentId: string,
    applications: readonly CdApplicationDto[],
    deployments: readonly CdDeploymentDto[],
    requests: readonly CdDeploymentRequestDto[] = [],
    platformApplications: readonly CdApplicationDto[] | null = null,
  ): Promise<void> {
    http.expectOne(`/platform-deployments/api/environments/${environmentId}`).flush({
      environment: { ...environment(environmentId, environmentId), applications },
    });
    if (platformApplications !== null) {
      http
        .expectOne('/platform-deployments/api/applications')
        .flush({ applications: platformApplications });
    }
    expectDeployments(environmentId).flush({ deployments });
    expectRequests(environmentId).flush({ deploymentRequests: requests });
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

    // The match is announced on the row, so the convention is visible rather than implied. No
    // branch: a release names a tag, and the column left the API.
    expect(text()).toContain('environment "qits" · network qits-net');

    await click('qits platform');
    expect(page().querySelector('.async-loading')).not.toBeNull();

    await flushEnvironment(
      'e1',
      [application('a1', 'qits-ci')],
      [deployment('d1', 'a1', { version: '2026.903.113443', commitSha: '9f2c1abcdef' })],
    );

    expect(text()).toContain('qits-ci');
    expect(text()).toContain('Active');
    // The version is the coordinate a deployment is identified by now; the sha is the commit
    // behind it, and both are drawn.
    expect(page().querySelector('td.version .calver')?.textContent).toBe('2026.903.113443');
    expect(text()).toContain('9f2c1ab');
    expect(text()).toContain('qits-ci-9f2c1ab');
    expect(text()).toContain('31 Jul 14:09');
  });

  it('says so when a project’s slug names no environment — the notifier may simply have failed', async () => {
    await open();
    await flushRoots([project('p2', 'scratch', 'scratch')], [environment('e1', 'qits')]);

    await click('scratch');

    expect(text()).toContain('No environment named "scratch" exists in qits-deployments.');
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
    expect(text()).toContain('Active');
  });

  it('has no platform section, and lists the platform services under the environment they deploy into', async () => {
    // The change this holds. There WAS a "Platform services" root, and it was right while a
    // platform service belonged to no environment: no project and no tier could reach one. It is
    // deployed into the designated environment now, so it is one more row in that environment's
    // table — and a section for services that ARE in an environment is a claim about where they run.
    await open();
    await flushRoots(
      [project('p1', 'qits', 'qits')],
      [environment('e1', 'qits', { platform: true })],
    );

    expect(text()).not.toContain('Platform services');

    await click('qits');
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-stt')],
      [
        deployment('d1', 'a1'),
        deployment('dp1', 'platform:qits-platform-idp', {
          applicationName: 'qits-platform-idp',
        }),
      ],
      [],
      [platformApplication('qits-platform-idp'), platformApplication('qits-ci')],
    );

    // One table, both kinds of service, sorted by name — the tier's own and the plane's beside it.
    expect(labels('td.version .calver').length).toBe(2);
    expect(text()).toContain('qits-stt');
    expect(text()).toContain('qits-platform-idp');
    // The join survives the merge: the deployment's `platform:<name>` id is the same key the flat
    // catalogue gives the application, so the row is Active rather than never deployed.
    expect(text()).toContain('Active');
    // And the never-deployed claim holds for a platform service too, for the same reason it always
    // did: the row comes from the catalogue, not from a deployment.
    expect(text()).toContain('qits-ci');
    expect(text()).toContain('never deployed');
    // The one thing still worth saying on the row: it is linked into no environment.
    expect(labels('.tier')).toContain('platform');
  });

  it('reads the flat catalogue for the designated environment only', async () => {
    // Every other environment costs three requests, not four. A platform service runs in exactly
    // one tier, and asking the flat catalogue on behalf of the others would list it in all of them.
    await open();
    await flushRoots(
      [project('p1', 'qits', 'qits'), project('p2', 'website', 'website')],
      [environment('e1', 'qits', { platform: true }), environment('e2', 'website')],
    );

    await click('website');
    await flushEnvironment('e2', [application('a2', 'qits-web')], []);

    // No `GET /applications` was made, and nothing else is outstanding.
    http.verify();
    expect(text()).toContain('qits-web');
    expect(labels('.tier')).not.toContain('platform');
  });

  it('keeps the tiered entries of the flat catalogue out of the merge', async () => {
    await open();
    await flushRoots([], [environment('e1', 'qits', { platform: true })]);

    await click('qits');
    await flushEnvironment(
      'e1',
      [],
      [],
      [],
      [platformApplication('qits-platform-idp'), application('e2:qits-stt', 'qits-stt')],
    );

    // `GET /applications` spans both planes — it is the listing that reaches the platform, not a
    // platform listing. A tier's application arrives through that tier's own aggregate or not at
    // all; merging the flat listing's tiered entries would put another environment's rows here.
    expect(text()).toContain('qits-platform-idp');
    expect(text()).not.toContain('qits-stt');
  });

  it('says nothing can deploy when no environment is the platform one', async () => {
    // Reachable on a half-bootstrapped install, and silent everywhere else: a release would enter
    // nowhere and report no error, so this page is where it shows. It used to be the platform
    // bucket's meta line; with the bucket gone it is a banner, because it is about the whole page.
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    expect(text()).toContain('No environment is the platform environment');
  });

  it('says which environment is the platform one, on its own row', async () => {
    await open();
    await flushRoots(
      [project('p1', 'qits', 'qits')],
      [environment('e1', 'qits', { platform: true })],
    );

    expect(text()).toContain('platform environment');
    expect(text()).not.toContain('No environment is the platform environment');
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
    expect(text()).not.toContain('Decommissioned');

    await click('qits-ci');

    expect(text()).toContain('1 earlier deployment');
    expect(text()).toContain('1de0447');
    expect(text()).toContain('Decommissioned');
    // The expansion is also where the deployment says what happened to it.
    expect(text()).toContain('31 Jul 2026 15:21:00Z');
  });

  it('reads the newest row as the current state whatever order the list arrives in', async () => {
    // The row-choice regression, and the direction it fails in is the whole reason this is pinned:
    // an operator was shown a stale FAILED attempt as the state of an application whose newest
    // deployment is ACTIVE — an outage reported where there is none. The bucket below arrives with
    // the OLDER row first, which is what an ordering this table inherits rather than performs
    // cannot survive.
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-ci')],
      [
        deployment('older', 'a1', {
          status: 'FAILED',
          commitSha: '1de0447aa',
          createdAt: '2026-07-31T13:31:00Z',
          detail: 'the registry refused the pull',
        }),
        deployment('newest', 'a1', {
          status: 'ACTIVE',
          commitSha: 'aa71903ff',
          createdAt: '2026-07-31T13:38:00Z',
        }),
      ],
    );

    expect(text()).toContain('Active');
    expect(text()).toContain('aa71903');
    // The failed attempt is history, so it is behind the expansion rather than on the row.
    expect(text()).not.toContain('Failed');
    expect(text()).not.toContain('1de0447');

    await click('qits-ci');

    expect(text()).toContain('1 earlier deployment');
    expect(text()).toContain('Failed');
    expect(text()).toContain('1de0447');
  });

  it('shows a newest row that is failing as failed, because that is the current state', async () => {
    // The mirror, and it is why the fix above is an ORDERING and never "prefer the ACTIVE row": an
    // application whose latest attempt failed over a predecessor that once served is down, and a
    // table that reached back for the healthy row would hide exactly the outage it exists to show.
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-ci')],
      [
        deployment('served', 'a1', {
          status: 'ACTIVE',
          commitSha: '1de0447aa',
          createdAt: '2026-07-31T13:31:00Z',
        }),
        deployment('failing', 'a1', {
          status: 'FAILED',
          commitSha: 'aa71903ff',
          createdAt: '2026-07-31T13:38:00Z',
        }),
      ],
    );

    expect(text()).toContain('Failed');
    expect(text()).toContain('aa71903');
    expect(text()).not.toContain('1de0447');
  });

  it('draws a held spec read as its own word rather than as a failure', async () => {
    // SPEC_UNREADABLE: the git host would not serve the file that says where this release goes, so
    // nothing about the repository is being claimed and the deployer is reading it again. It is a
    // warning and not a danger, and it must never render as the raw enum word.
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-deployments')],
      [
        deployment('d1', 'a1', {
          status: 'SPEC_UNREADABLE',
          containerName: null,
          detail: '[deployment spec unreadable: the git host answered 403]',
        }),
      ],
    );

    expect(text()).toContain('Spec unreadable');
    expect(text()).not.toContain('SPEC_UNREADABLE');
    // Nothing is running under it, so there is no lever to offer.
    expect(text()).toContain('nothing running');
  });

  it('shows what a release asked for beside what it became, on the row it happened to', async () => {
    // The lifecycle a `SoftwareRelease` produces, on one line: request → gate → deployment. The
    // request is folded into the application's row by name, because the deployment on that row is
    // what this very request produced.
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-ci')],
      [deployment('d1', 'a1', { version: '2026.903.113443' })],
      [request('r1', 'qits-ci', { version: '2026.903.113443', deploymentId: 'd1' })],
    );

    // Nothing outstanding: the newest request IS the deployment on the row, so the version cell
    // says the version once and does not claim something else was asked for.
    expect(page().querySelector('.outstanding')).toBeNull();

    await click('qits-ci');
    expect(text()).toContain('1 release asked for here');
    expect(text()).toContain('Gate met');
    expect(text()).toContain('deployed');
  });

  it('shows a refused release, which has no deployment row anywhere to be seen through', async () => {
    // The whole reason this listing exists. A request the gate refused queued nothing, so the
    // deployments listing cannot show it and a page reading only that one would draw the release
    // as never having happened.
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-ci')],
      [deployment('d1', 'a1', { version: '2026.903.113443' })],
      [
        request('r2', 'qits-ci', {
          version: '2026.903.120000',
          qualityGate: 'UNMET',
          gateDetail: 'the userflow suite failed against dev',
          createdAt: '2026-07-31T15:00:00Z',
        }),
        request('r1', 'qits-ci', { version: '2026.903.113443', deploymentId: 'd1' }),
      ],
    );

    // What is running is not what was last asked for, and the cell says both.
    expect(page().querySelector('td.version .calver')?.textContent).toBe('2026.903.113443');
    expect(page().querySelector('.outstanding')?.textContent).toContain('2026.903.120000');
    expect(page().querySelector('.outstanding')?.textContent).toContain('gate unmet');
    // The status is still the deployment's: nothing failed, and the tier is serving what it serves.
    expect(text()).toContain('Active');

    await click('qits-ci');
    expect(text()).toContain('Gate unmet');
    expect(text()).toContain('nothing was deployed');
    expect(text()).toContain('the userflow suite failed against dev');
  });

  it('gives a release a row even when the application it names is not in the catalogue', async () => {
    // A request outlives the catalogue row by design — no foreign key, on purpose — so a refusal
    // for a torn-down application still has somewhere to be read. A row that exists and is not
    // drawn is the one failure this table must not have.
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment(
      'e1',
      [],
      [],
      [request('r1', 'qits-retired', { qualityGate: 'UNMET', gateDetail: 'no such application' })],
    );

    expect(text()).toContain('qits-retired');
    expect(text()).toContain('no longer tracked');
    expect(text()).toContain('never deployed');
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

    expect(text()).toContain('Image missing');
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

    // A plain href across applications: qits-ci is another SPA on a host of its own, and this app's
    // router owns nothing outside this host. The address comes from the platform's navigation.
    const link = page().querySelector<HTMLAnchorElement>(
      `a[href="${CI_ORIGIN}/runs/da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61"]`,
    );
    expect(link).not.toBeNull();
    expect(link?.getAttribute('title')).toContain('9f2c1ab3d4e5f6');

    // The row with no runId — every row written before cd recorded it — is a plain sha.
    expect(page().querySelectorAll(`a[href^="${CI_ORIGIN}/runs/"]`)).toHaveLength(1);
    expect(text()).toContain('9f2c1ab');
  });

  /**
   * A platform naming no ci application leaves the sha as text.
   *
   * There is nothing to fall back on: every service is on a host of its own, so a `/ci/` segment
   * under the environment origin is not an address, and an anchor with no href is a link to
   * nowhere.
   */
  it('draws the sha as text when the platform names no ci application', async () => {
    TestBed.resetTestingModule();
    configure(navigation(false));
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-ci')],
      [deployment('d1', 'a1', { runId: 'da4a3f0e-11c2-4f7a-9b03-2ee45c1f8d61' })],
    );

    expect(page().querySelector('td.commit a')).toBeNull();
    expect(page().querySelector('td.commit code')?.textContent).toContain('9f2c1ab');
  });

  it('collapses a failed expansion to one retry on that row, and retries it in place', async () => {
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    http
      .expectOne('/platform-deployments/api/environments/e1')
      .flush(null, { status: 503, statusText: 'Service Unavailable' });
    expectDeployments('e1').flush(null, { status: 503, statusText: 'Service Unavailable' });
    expectRequests('e1').flush(null, { status: 503, statusText: 'Service Unavailable' });
    await settle();

    // One failure, not three: the table needs the catalogue and the deployments, so it is one thing
    // that did not load — and the requests, which it does not need, do not add a second error.
    expect(text()).toContain('Could not load deployments — 503');
    expect(page().querySelectorAll('.async-error')).toHaveLength(1);

    await click('Retry');
    await flushEnvironment('e1', [application('a1', 'qits-ci')], [deployment('d1', 'a1')]);

    expect(text()).not.toContain('Could not load deployments');
    expect(text()).toContain('qits-ci');
  });

  it('draws the table without the requests and names what is missing when they fail', async () => {
    // The requests are not in the state the table gates on, and this is why: everything on screen
    // is still exactly what the server said ran. What is missing is the one thing this table could
    // otherwise be quietly wrong about — a release that asked for something and got nothing.
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);

    await click('qits');
    http.expectOne('/platform-deployments/api/environments/e1').flush({
      environment: { ...environment('e1', 'qits'), applications: [application('a1', 'qits-ci')] },
    });
    expectDeployments('e1').flush({ deployments: [deployment('d1', 'a1')] });
    expectRequests('e1').flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(text()).toContain('qits-ci');
    expect(text()).toContain('Active');
    expect(text()).toContain('Deployment requests unavailable — 503');
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
    expect(text()).not.toContain('exists in qits-deployments');
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

    expect(text()).toContain('following 1 environment');

    await tick(POLL_INTERVAL_MS);
    // The two moving lists are re-read and the catalogue is not: what an environment tracks does
    // not change mid-start, and the request is the first step of the same lifecycle as the row.
    expectDeployments('e1').flush({
      deployments: [deployment('d1', 'a1', { status: 'STARTING', finishedAt: null })],
    });
    expectRequests('e1').flush({ deploymentRequests: [] });
    await settle();

    await tick(POLL_INTERVAL_MS);
    expectDeployments('e1').flush({ deployments: [deployment('d1', 'a1', { status: 'ACTIVE' })] });
    expectRequests('e1').flush({ deploymentRequests: [] });
    await settle();

    expect(text()).toContain('Active');
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
    expectRequests('e1').flush({ deploymentRequests: [] });
    await settle();

    expect(text()).toContain('Active');
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
    expectRequests('e1').flush({ deploymentRequests: [] });
    await settle();

    expect(text()).toContain('The last refresh failed — 503');
    expect(text()).toContain('Starting');
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
  // --- the operator's two levers ----------------------------------------------------------------

  /** Expand a tier holding one application whose newest deployment is in the given state. */
  async function openTierWith(over: Partial<CdDeploymentDto> = {}): Promise<void> {
    await open();
    await flushRoots([project('p1', 'qits', 'qits')], [environment('e1', 'qits')]);
    await click('qits');
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-ci')],
      [deployment('d1', 'a1', over)],
    );
  }

  function expectOperation(path: string) {
    return http.expectOne(`/platform-deployments/api/applications/${path}`);
  }

  it('restarts an application in place and reads the plane back', async () => {
    // The lever the whole feature exists for: qits-ci up, healthy to its probe, and wedged behind
    // it. Before this the only recovery was re-firing a same-sha push and waiting for a rebuild.
    await openTierWith();

    await click('Restart');

    const request = expectOperation('a1/restart');
    expect(request.request.method).toBe('POST');
    request.flush({});
    await settle();

    // Nothing is believed about the outcome: the service answers 202 and the row is the answer, so
    // the plane is re-read rather than patched in place.
    await flushEnvironment('e1', [application('a1', 'qits-ci')], [deployment('d1', 'a1')]);
    expect(text()).toContain('Active');
  });

  it('asks before stopping, and stops nothing until the question is answered', async () => {
    // Stopping is the one action here that takes an application off the platform, so it is asked
    // twice — and the question names the row, because this is a table an operator scans.
    await openTierWith();

    await click('Stop');
    expect(text()).toContain('Stop qits-ci?');
    http.verify(); // nothing was sent by opening the question

    await click('Cancel');
    expect(text()).not.toContain('Stop qits-ci?');
    http.verify();

    await click('Stop');
    await click('Yes, stop it');
    const request = expectOperation('a1/scale');
    expect(request.request.body).toEqual({ replicas: 0 });
    request.flush({});
    await settle();
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-ci')],
      [deployment('d1', 'a1', { status: 'SCALED_TO_ZERO' })],
    );

    expect(text()).toContain('Stopped');
  });

  it('offers Start on a stopped application and neither of the other two', async () => {
    // A stopped row must not offer Stop (an action with no effect) or Restart (which the service
    // refuses: there is no task to replace). The row's own status is what decides.
    await openTierWith({ status: 'SCALED_TO_ZERO' });

    const labels = buttons().map((button) => button.textContent ?? '');
    expect(labels.some((label) => label.includes('Start'))).toBe(true);
    expect(labels.some((label) => label.includes('Restart'))).toBe(false);
    expect(labels.some((label) => label.includes('Stop'))).toBe(false);

    await click('Start');
    const request = expectOperation('a1/scale');
    expect(request.request.body).toEqual({ replicas: 1 });
    request.flush({});
    await settle();
    await flushEnvironment(
      'e1',
      [application('a1', 'qits-ci')],
      [deployment('d1', 'a1', { status: 'SCALED_TO_ZERO' })],
    );

    // Still stopped, and that is correct rather than a bug: qits-deployments settles a started row
    // when its own observation finds the tasks healthy, which is up to one interval later. This
    // page must not invent a completion the service never promised.
    expect(text()).toContain('Stopped');
  });

  it('draws no lever at all for a deployment that never reached the orchestrator', async () => {
    // IMAGE_MISSING is the everyday shape: the row exists, the pull failed, and no service anywhere
    // carries the application. The service answers 409, so the button would be one that cannot work.
    await openTierWith({ status: 'IMAGE_MISSING', containerName: null });

    expect(text()).toContain('nothing running');
    const labels = buttons().map((button) => button.textContent ?? '');
    expect(labels.some((label) => label.includes('Restart'))).toBe(false);
  });

  it('says beside the table when an operation is refused, and keeps the table', async () => {
    await openTierWith();

    await click('Restart');
    expectOperation('a1/restart').flush(null, { status: 403, statusText: 'Forbidden' });
    await settle();

    expect(text()).toContain('Could not restart qits-ci');
    expect(text()).toContain('403');
    // The row is still on screen: a refused action says nothing about what is deployed.
    expect(text()).toContain('qits-ci-9f2c1ab');
  });

  it('takes the buttons away while an operation is in flight, so one wedge is one restart', async () => {
    await openTierWith();

    await click('Restart');
    await settle();

    expect(text()).toContain('queued…');
    expect(buttons().map((button) => button.textContent ?? '').some((l) => l.includes('Restart')))
      .toBe(false);

    expectOperation('a1/restart').flush({});
    await settle();
    await flushEnvironment('e1', [application('a1', 'qits-ci')], [deployment('d1', 'a1')]);

    expect(text()).not.toContain('queued…');
  });
});
