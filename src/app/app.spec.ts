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
      providers: [provideRouter(routes), provideLocationMocks()],
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
    expect(layout.querySelectorAll('.qits-layout-link')).toHaveLength(7);
    expect(layout.querySelector('.qits-layout-content router-outlet')).not.toBeNull();
  });

  it('has no door of its own in the navigation yet', async () => {
    // The layout reads the *document's* base URI, not the router, to decide which SPA it is; this
    // app is served under `<base href="/cd/">`, so the test document has to say the same. That
    // segment is not among ui-components 0.0.3's seven links, so the layout marks nothing current
    // — correct today, and this assertion is what will fail on the release that adds /cd.
    document.head.appendChild(Object.assign(document.createElement('base'), { href: '/cd/' }));
    try {
      const harness = await RouterTestingHarness.create('/');

      const layout = harness.routeNativeElement as HTMLElement;
      expect(layout.querySelectorAll('.qits-layout-link[aria-current="page"]')).toHaveLength(0);
    } finally {
      document.head.querySelector('base')?.remove();
    }
  });
});
