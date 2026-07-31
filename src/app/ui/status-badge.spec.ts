import { TestBed } from '@angular/core/testing';
import { StatusBadge } from './status-badge';

/**
 * The map is the component, so the map is what is asserted — including the fallback, because a new
 * `CdDeploymentStatus` must render as a plain badge rather than crash or claim success.
 */
describe('StatusBadge', () => {
  async function toneOf(status: string): Promise<string> {
    const fixture = TestBed.createComponent(StatusBadge);
    fixture.componentRef.setInput('status', status);
    await fixture.whenStable();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('qits-badge');
    return badge?.firstElementChild?.className ?? '';
  }

  it('gives a deployment the tone that says what it is', async () => {
    expect(await toneOf('ACTIVE')).toContain('success');
    expect(await toneOf('STARTING')).toContain('info');
    expect(await toneOf('QUEUED')).toContain('neutral');
    expect(await toneOf('FAILED')).toContain('danger');
  });

  it('reads IMAGE_MISSING as a warning, because nothing here failed', async () => {
    expect(await toneOf('IMAGE_MISSING')).toContain('warning');
  });

  it('reads DECOMMISSIONED as neutral, because it is history and not a fault', async () => {
    expect(await toneOf('DECOMMISSIONED')).toContain('neutral');
  });

  it('falls back to neutral for a status this build has never heard of', async () => {
    expect(await toneOf('SOMETHING_NEW')).toContain('neutral');
  });

  it('renders the status word itself — a coloured dot is not a status', async () => {
    const fixture = TestBed.createComponent(StatusBadge);
    fixture.componentRef.setInput('status', 'IMAGE_MISSING');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('IMAGE_MISSING');
  });
});
