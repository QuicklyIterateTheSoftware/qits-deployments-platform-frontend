import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type { ProjectDto, ProjectEntriesResponse } from './dto';

/**
 * The one read this app makes against qits-projects: the project spine of the page.
 *
 * One method, not two. qits-spa-ci's copy of this service also fetches a project's repositories,
 * because its tree walks down to them; this screen never does — its second level is the cd
 * environment a project's slug names, and repositories appear only as a column copied off
 * `CdApplicationDto.repoId`. Carrying a `repositories()` nobody calls would be a shared-code
 * instinct applied to a file that is deliberately not shared.
 *
 * Duplicated from qits-spa-ci rather than extracted (Decision 2): the alternative is putting a
 * transport dependency into `@qits/ui-components`, which six SPAs consume without making a request,
 * and turning every change here into a library publish plus a version bump in seven applications.
 * The platform's own precedent is the same — qits-ci duplicates qits-events' wire contract as its
 * own DTOs rather than depending on the domain module.
 */
@Injectable({ providedIn: 'root' })
export class ProjectsApi {
  private readonly http = inject(HttpClient);

  private readonly base = inject(QITS_API_BASE);

  /** Every project. One request, on page load, and the spine everything else hangs from. */
  async projects(): Promise<readonly ProjectDto[]> {
    const response = await firstValueFrom(
      this.http.get<ProjectEntriesResponse>(`${this.base}/projects/api/projects`),
    );
    return response.entries.map((entry) => entry.project);
  }
}
