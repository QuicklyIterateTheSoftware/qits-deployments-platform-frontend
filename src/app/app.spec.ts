import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';

/**
 * The shell owns one thing — the outlet — so that is what is asserted here, plus the route table
 * actually reaching the shared layout behind it. What the layout itself renders is the
 * ui-components package's business; this only checks that this app mounts it.
 */
describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      // The root route is now the deployments page, and it reads two services on arrival — so this
      // suite needs a backend even though what it asserts is the shell and the chrome. The
      // requests are never flushed here; nothing in this file is about what comes back.
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  it('is an outlet and nothing else', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const shell = fixture.nativeElement as HTMLElement;
    expect(shell.querySelector('router-outlet')).not.toBeNull();
    expect(shell.querySelector('qits-main-layout')).toBeNull();
  });

  it('routes the root URL to the shared layout', async () => {
    const harness = await RouterTestingHarness.create('/');

    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.querySelector('.qits-layout-brand')?.textContent).toContain('qits');
    expect(layout.querySelectorAll('.qits-layout-link')).toHaveLength(8);
    expect(layout.querySelector('.qits-layout-content router-outlet')).not.toBeNull();
  });

  it('has a door in the navigation, whatever that door currently points at', async () => {
    // The navigation entries come from @qits/ui-components, and its CD entry still says `/cd/`
    // while this app now serves at `/platform-deployments/`. So the door exists and is NOT marked
    // current: the layout decides which SPA it is by comparing each href against the *document's*
    // base URI, and those two strings no longer match.
    //
    // What is asserted is therefore the entry's presence, which survives the library's move in
    // either direction. The href and the current-marking are deliberately not asserted — pinning
    // `/cd/` would freeze a value this repo does not own, and pinning `/platform-deployments/`
    // would fail every build until the library ships, including the release train's own bump.
    const harness = await RouterTestingHarness.create('/');

    const layout = harness.routeNativeElement as HTMLElement;
    const labels = Array.from(layout.querySelectorAll('.qits-layout-link')).map((link) =>
      link.textContent?.trim(),
    );
    expect(labels).toContain('Deployments');
  });
});
