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
import type {
  CdDeploymentDto,
  CdDeploymentRequestDto,
  ProjectsReleaseRequestDto,
} from '../api/dto';
import { CD_REQUEST_POLL_MS } from './poll-interval';

/**
 * One request's page: the three tiles, and what each of them is allowed to claim.
 *
 * The tiles are where every judgement on this screen lives, so they are what this suite asserts.
 * **Running is decided by the tier's newest ACTIVE row and not by this request's own deployment**,
 * because a deployment that says `ACTIVE` may have been decommissioned an hour later and a reader
 * asking "is my version live" would be told yes. **Merged is decided by qits-projects**, which is
 * the one step qits-deployments cannot see — and a read that fails leaves the tile *pending* with a
 * meta line saying so, because not knowing whether something merged is not knowing it did not.
 */
const PROJECTS = [{ id: 'p1', slug: 'qits', name: 'QITS' }];

const POLL_MS = 30;

describe('DeploymentRequestPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const request = (over: Partial<CdDeploymentRequestDto> = {}): CdDeploymentRequestDto => ({
    id: 'r1',
    applicationName: 'qits-ci',
    version: '2026.903.113443',
    environmentId: 'e1',
    packageName: 'qits/qits-ci',
    repoId: 'repo-ci',
    projectId: 'p1',
    qualityGate: 'MET',
    gateDetail: null,
    deploymentId: 'd1',
    createdAt: '2026-07-31T14:09:00Z',
    gateSettledAt: '2026-07-31T14:09:00Z',
    deploymentStatus: 'ACTIVE',
    ...over,
  });

  const deployment = (over: Partial<CdDeploymentDto> = {}): CdDeploymentDto => ({
    id: 'd1',
    applicationId: 'e1:qits-ci',
    applicationName: 'qits-ci',
    version: '2026.903.113443',
    commitSha: '9f2c1ab3d4e5f6',
    status: 'ACTIVE',
    containerName: 'dev-qits-ci',
    detail: null,
    createdAt: '2026-07-31T14:09:04Z',
    finishedAt: '2026-07-31T14:09:45Z',
    runId: null,
    ...over,
  });

  const releaseRequest = (
    over: Partial<ProjectsReleaseRequestDto> = {},
  ): ProjectsReleaseRequestDto => ({
    version: '2026.903.113443',
    mergedToMainAt: '2026-07-31T14:20:00Z',
    state: 'RELEASED',
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

  async function open(): Promise<void> {
    harness = await RouterTestingHarness.create('/qits/deployment-requests/r1');
    await settle();
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  /** The three tiles as `[title, state]`, which is the whole of what this page decides. */
  function tiles(): [string, string][] {
    return Array.from(page().querySelectorAll('.stage')).map((stage) => [
      stage.querySelector('.title')?.textContent ?? '',
      stage.className.replace('stage', '').trim(),
    ]);
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await harness.fixture.whenStable();
    }
  }

  async function pastOnePoll(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 4));
    await settle();
  }

  /**
   * The four reads a load costs: the request, then the tier's rows, the environment list and
   * qits-projects' release requests — the last three all taking arguments off the first.
   */
  async function flushLoad(options: {
    request: CdDeploymentRequestDto;
    deployment: CdDeploymentDto | null;
    deployments: readonly CdDeploymentDto[];
    releaseRequests?: readonly ProjectsReleaseRequestDto[] | 'down';
  }): Promise<void> {
    http
      .expectOne('/platform-deployments/api/deployment-requests/r1')
      .flush({ deploymentRequest: options.request, deployment: options.deployment });
    await settle();
    http
      .expectOne('/platform-deployments/api/environments')
      .flush({ environments: [{ id: 'e1', name: 'dev', network: 'qits-net', platform: true }] });
    http
      .expectOne(
        (candidate) =>
          candidate.url === '/platform-deployments/api/deployments' &&
          candidate.params.get('environmentId') === 'e1',
      )
      .flush({ deployments: options.deployments });
    const releases = http.expectOne(
      '/projects/api/repositories/repo-ci/release-requests?state=RELEASED',
    );
    if (options.releaseRequests === 'down') {
      releases.flush(null, { status: 503, statusText: 'Down' });
    } else {
      releases.flush({ requests: options.releaseRequests ?? [] });
    }
    await settle();
  }

  it('draws three reached tiles for a version that is serving and has landed on main', async () => {
    await open();
    await flushLoad({
      request: request(),
      deployment: deployment(),
      deployments: [deployment()],
      releaseRequests: [releaseRequest()],
    });

    expect(tiles()).toEqual([
      ['Released 2026.903.113443', 'reached'],
      ['Running in dev', 'reached'],
      ['Merged to main', 'reached'],
    ]);
    // The facts under the flow are the request's and the deployment's, side by side.
    expect(text()).toContain('Gate met');
    expect(text()).toContain('qits/qits-ci');
    expect(text()).toContain('9f2c1ab');
    expect(text()).toContain('dev-qits-ci');
  });

  it('leaves the tiles pending while the deployment is still in flight', async () => {
    await open();
    await flushLoad({
      request: request({ deploymentStatus: 'STARTING' }),
      deployment: deployment({ status: 'STARTING', finishedAt: null }),
      deployments: [],
      releaseRequests: [releaseRequest({ mergedToMainAt: null })],
    });

    expect(tiles()).toEqual([
      ['Released 2026.903.113443', 'reached'],
      ['Running in dev', 'pending'],
      ['Merged to main', 'pending'],
    ]);
    expect(text()).toContain('deploying');
    expect(text()).toContain('not merged yet');
    expect(text()).toContain('following this release');
  });

  it('stops the tier tile when the gate refused the release outright', async () => {
    // The whole reason this page exists: a refusal queued no deployment at all, so there is no
    // deployment row anywhere that could say what happened.
    await open();
    await flushLoad({
      request: request({
        qualityGate: 'UNMET',
        gateDetail: 'the userflow suite failed against dev',
        deploymentId: null,
        deploymentStatus: null,
      }),
      deployment: null,
      deployments: [],
    });

    expect(tiles()[1]).toEqual(['Running in dev', 'stopped']);
    expect(text()).toContain('the gate refused it');
    expect(text()).toContain('the userflow suite failed against dev');
    expect(text()).toContain('No deployment was queued for this request');
    // Stopped is terminal: nothing here is going to change, so nothing is re-read.
    expect(text()).not.toContain('following this release');
  });

  it('stops the tier tile when the orchestrator put the predecessor back', async () => {
    await open();
    await flushLoad({
      request: request({ deploymentStatus: 'ROLLED_BACK' }),
      deployment: deployment({ status: 'ROLLED_BACK', detail: 'rollback_completed' }),
      // The tier is serving the version this release tried to replace, and the tile says which.
      deployments: [deployment({ id: 'd0', version: '2026.903.100000' })],
      releaseRequests: [releaseRequest({ mergedToMainAt: null })],
    });

    expect(tiles()[1]).toEqual(['Running in dev', 'stopped']);
    expect(text()).toContain('rolled back to the predecessor');
    expect(text()).toContain('dev is running 2026.903.100000');
    expect(text()).toContain('rollback_completed');
  });

  it('leaves the merge tile pending and honest when qits-projects does not answer', async () => {
    // Not knowing whether something merged is not knowing it did not — and a version that deployed
    // an hour ago is still a true and useful screen with qits-projects down.
    await open();
    await flushLoad({
      request: request(),
      deployment: deployment(),
      deployments: [deployment()],
      releaseRequests: 'down',
    });

    expect(tiles()).toEqual([
      ['Released 2026.903.113443', 'reached'],
      ['Running in dev', 'reached'],
      ['Merged to main', 'pending'],
    ]);
    expect(text()).toContain('qits-projects did not answer — 503');
  });

  it('stops polling once every stage is reached', async () => {
    await open();
    await flushLoad({
      request: request({ deploymentStatus: 'STARTING' }),
      deployment: deployment({ status: 'STARTING', finishedAt: null }),
      deployments: [],
      releaseRequests: [releaseRequest({ mergedToMainAt: null })],
    });

    await pastOnePoll();
    http
      .expectOne('/platform-deployments/api/deployment-requests/r1')
      .flush({ deploymentRequest: request(), deployment: deployment() });
    await settle();
    http
      .expectOne(
        (candidate) =>
          candidate.url === '/platform-deployments/api/deployments' &&
          candidate.params.get('environmentId') === 'e1',
      )
      .flush({ deployments: [deployment()] });
    http
      .expectOne('/projects/api/repositories/repo-ci/release-requests?state=RELEASED')
      .flush({ requests: [releaseRequest()] });
    await settle();

    expect(tiles().every(([, state]) => state === 'reached')).toBe(true);
    // A poll re-reads the request, the tier and the merge — never the environment list, since what
    // tiers exist does not change while a container starts.
    await pastOnePoll();
    await pastOnePoll();
    http.verify();
  });
});
