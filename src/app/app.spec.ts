import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks } from '@qits/ui-components';
import { App } from './app';
import { routes } from './app.routes';

/**
 * A fixture navigation, not the platform's. `provideQitsNavigationLinks` answers the layout's
 * `QITS_NAVIGATION` from a literal, so the chrome never asks for `/main-navigation` — no request to
 * flush, and nothing pending to keep the harness from settling.
 *
 * The `/` entry is here on purpose: the test document's base href is `/`, so that is the entry the
 * layout should mark as this application. See the last case below.
 */
const NAV = [
  { label: 'Home', href: '/' },
  { label: 'CI', href: '/ci/' },
  { label: 'Deployments', href: '/platform-deployments/' },
] as const;

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
        provideQitsNavigationLinks(NAV),
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
    // This used to assert a literal 8, on the reasoning that a stale @qits/ui-components resolves,
    // builds and renders, and the count is what notices. The list is no longer in the package: it
    // is what qits-gateway answers `/main-navigation` with, so how many doors the platform has is
    // a deployment fact and asserting it is the gateway's own spec's job. What is proved here is
    // that this app mounts the chrome and the chrome renders exactly what it was told.
    const labels = Array.from(layout.querySelectorAll('.qits-layout-link')).map((link) =>
      link.textContent?.trim(),
    );
    expect(labels).toEqual(NAV.map((link) => link.label));
    expect(layout.querySelector('.qits-layout-content router-outlet')).not.toBeNull();
  });

  it('marks the entry that is this application, and only that one', async () => {
    // Which entry is "here" is not in the list: the layout works it out by comparing each href
    // against the *document's* base URI. Under test that base is `/`, so the `/` entry is the
    // current one; in the deployment the same comparison lands on `/platform-deployments/`.
    //
    // Where this app is actually served, and whether the gateway spells its door that way, is
    // deliberately not asserted — that is a value this repo does not own.
    const harness = await RouterTestingHarness.create('/');

    const layout = harness.routeNativeElement as HTMLElement;
    const current = Array.from(layout.querySelectorAll('.qits-layout-link-current'));
    expect(current.map((link) => link.textContent?.trim())).toEqual(['Home']);
    expect(current[0].getAttribute('aria-current')).toBe('page');
  });
});
