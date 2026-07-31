import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ProjectsApi } from './projects-api';

/**
 * qits-projects wraps every list in `entries`, and every entry in the name of the thing it holds.
 * That is genuinely different from cd's `{environments: […]}`, so the client unwraps rather than
 * pretends the two services agree.
 */
describe('ProjectsApi', () => {
  let api: ProjectsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ProjectsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('unwraps the project entries, slug and all', async () => {
    const projects = api.projects();
    http.expectOne('/projects/api/projects').flush({
      entries: [
        {
          project: { id: 'p1', name: 'qits platform', slug: 'qits', description: null, dns: null },
        },
      ],
    });
    // The slug is the field this app joins on; the name is only what the row is called.
    await expect(projects).resolves.toMatchObject([{ id: 'p1', slug: 'qits' }]);
  });
});
