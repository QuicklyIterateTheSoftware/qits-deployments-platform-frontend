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

  it('has a door of its own in the navigation', async () => {
    // The release this assertion was waiting for. ui-components 0.0.4 adds the `/cd/` entry — after
    // CI — and takes the link count above to eight, so the segment this app is served under is now
    // among the navigation's own destinations. The layout reads the *document's* base URI, not the
    // router, to decide which SPA it is; this app is served under `<base href="/cd/">`, so the test
    // document has to say the same. It marks exactly one link current, and that link is CD.
    document.head.appendChild(Object.assign(document.createElement('base'), { href: '/cd/' }));
    try {
      const harness = await RouterTestingHarness.create('/');

      const layout = harness.routeNativeElement as HTMLElement;
      const current = layout.querySelectorAll('.qits-layout-link[aria-current="page"]');
      expect(current).toHaveLength(1);
      expect(current[0].textContent?.trim()).toBe('CD');
      expect(current[0].getAttribute('href')).toBe('/cd/');
    } finally {
      document.head.querySelector('base')?.remove();
    }
  });
});
