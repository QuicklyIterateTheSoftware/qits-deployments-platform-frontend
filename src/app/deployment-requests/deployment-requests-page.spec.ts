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
import { routes } from '../app.routes';
import type { CdDeploymentRequestDto } from '../api/dto';
import { CD_REQUEST_POLL_MS } from './poll-interval';

/**
 * The project's release list, one `it` at a time, through `HttpTestingController`.
 *
 * Three assertions carry more than their length. **The split**, because pending and completed are
 * the two sections this page exists to draw and the rule that separates them is the server's — a
 * client that disagreed would show rows in the section the cap never counted. **The bare route that
 * makes no request**, because an empty listing and an unscoped one look identical on screen and are
 * not the same answer. And **the poll that stops**, because a poll that does not stop is invisible
 * in review: the page looks right and the tab re-reads a settled project forever.
 *
 * `CD_REQUEST_POLL_MS` is overridden rather than faked. Angular's zoneless scheduler races its own
 * `setTimeout` against a `requestAnimationFrame`, so a suite faking `setTimeout` would freeze
 * rendering and never reach a stable fixture — the interval is a token precisely so a spec has a
 * seam that is not the clock.
 */
const PROJECTS = [{ id: 'p1', slug: 'qits', name: 'QITS' }];

/**
 * How long the poll waits in this suite.
 *
 * Long enough that the fixture settles between an answer and the next timer — `settle()` costs real
 * milliseconds — and short enough that waiting past one is not a slow suite.
 */
const POLL_MS = 30;

describe('DeploymentRequestsPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const request = (
    id: string,
    over: Partial<CdDeploymentRequestDto> = {},
  ): CdDeploymentRequestDto => ({
    id,
    applicationName: 'qits-ci',
    version: '2026.903.113443',
    environmentId: 'e1',
    packageName: 'qits/qits-ci',
    repoId: 'repo-ci',
    projectId: 'p1',
    qualityGate: 'MET',
    gateDetail: null,
    deploymentId: `d-${id}`,
    createdAt: '2026-07-31T14:09:00Z',
    gateSettledAt: '2026-07-31T14:09:00Z',
    deploymentStatus: 'ACTIVE',
    ...over,
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
        { provide: CD_REQUEST_POLL_MS, useValue: POLL_MS },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => setHidden(false));

  async function open(url: string): Promise<void> {
    harness = await RouterTestingHarness.create(url);
    await settle();
  }

  function text(): string {
    return (harness.fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  /** See `deployments-page.spec.ts`: a real macrotask drains a promise chain of any depth. */
  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await harness.fixture.whenStable();
    }
  }

  /** Wait past one poll interval on the real clock, then let the answer land. */
  async function pastOnePoll(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 4));
    await settle();
  }

  function setHidden(hidden: boolean): void {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  }

  function expectRequests() {
    return http.expectOne(
      (candidate) =>
        candidate.url === '/platform-deployments/api/deployment-requests' &&
        candidate.params.get('projectId') === 'p1',
    );
  }

  async function flushRequests(rows: readonly CdDeploymentRequestDto[]): Promise<void> {
    expectRequests().flush({ deploymentRequests: rows });
    await settle();
  }

  it('reads the project once and splits the answer into pending and completed', async () => {
    // The split is `isCompletedRequest`, which mirrors the server's RequestLifecycle: the gate
    // unanswered or the deployment still in flight is pending, and everything else — a refusal
    // included — is finished.
    await open('/qits/deployment-requests');
    await flushRequests([
      request('r3', { version: '2026.903.3', deploymentStatus: 'STARTING' }),
      request('r2', { version: '2026.903.2', deploymentStatus: 'ACTIVE' }),
      request('r1', {
        version: '2026.903.1',
        qualityGate: 'UNMET',
        gateDetail: 'the userflow suite failed against dev',
        deploymentId: null,
        deploymentStatus: null,
      }),
    ]);

    const sections = Array.from(
      (harness.fixture.nativeElement as HTMLElement).querySelectorAll('section'),
    );
    expect(sections).toHaveLength(2);
    expect(sections[0].textContent).toContain('2026.903.3');
    expect(sections[0].textContent).not.toContain('2026.903.2');
    // A refusal is COMPLETED and not pending: the gate answered, it queued nothing, and polling it
    // would never end.
    expect(sections[1].textContent).toContain('2026.903.1');
    expect(sections[1].textContent).toContain('2026.903.2');
    expect(sections[1].textContent).toContain('Gate unmet');
    // The cap is the server's, and the caption is where that is said out loud.
    expect(text()).toContain('The last 10, newest first.');
    // A refused request has no deployment to have a status, and the row says which absence it is.
    expect(sections[1].textContent).toContain('nothing was deployed');
  });

  it('links each row to its own page, inside the scope the reader is in', async () => {
    await open('/qits/deployment-requests');
    await flushRequests([request('r1')]);

    const link = (harness.fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(
      'td.open a',
    );
    expect(link?.getAttribute('href')).toBe('/qits/deployment-requests/r1');
  });

  it('makes no request at all outside a project, and says why', async () => {
    // An empty list here would be indistinguishable from a project that has never released, and the
    // two are different answers. There is also no project id to ask with.
    await open('/deployment-requests');

    expect(text()).toContain('Deployment requests are read per project');
    http.verify();
  });

  it('polls while something is pending and stops when the last one settles', async () => {
    await open('/qits/deployment-requests');
    await flushRequests([request('r1', { deploymentStatus: 'STARTING' })]);

    expect(text()).toContain('following 1 release');

    await pastOnePoll();
    await flushRequests([request('r1', { deploymentStatus: 'ACTIVE' })]);

    expect(text()).toContain('Active');
    expect(text()).not.toContain('following');

    // Settled: the chain is not re-armed, so nothing is asked again however long the tab is open.
    await pastOnePoll();
    await pastOnePoll();
    http.verify();
  });

  it('polls nothing behind a hidden tab and reads once when it comes back', async () => {
    // Hidden before the rows land, so the chain is never armed rather than armed and cancelled —
    // the claim is about what a background tab costs, and a race would make it about timing.
    setHidden(true);
    await open('/qits/deployment-requests');
    await flushRequests([request('r1', { deploymentStatus: 'QUEUED' })]);

    await pastOnePoll();
    await pastOnePoll();
    http.verify();

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    // Coming back is worth one immediate read rather than up to six seconds of stale screen.
    await flushRequests([request('r1', { deploymentStatus: 'ACTIVE' })]);

    expect(text()).toContain('Active');
  });

  it('keeps the rows on screen when a poll fails, and says so', async () => {
    await open('/qits/deployment-requests');
    await flushRequests([request('r1', { deploymentStatus: 'STARTING' })]);

    await pastOnePoll();
    expectRequests().flush(null, { status: 503, statusText: 'Down' });
    await settle();

    expect(text()).toContain('The last refresh failed — 503');
    expect(text()).toContain('Starting');
  });
});
