import { TestBed } from '@angular/core/testing';
import { StatusBadge } from './status-badge';

/**
 * The two maps are the component, so the maps are what is asserted — including both fallbacks,
 * because a new `CdDeploymentStatus` must render as a plain badge carrying its own word rather than
 * crash, claim success or come out empty.
 */
describe('StatusBadge', () => {
  async function render(status: string): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(StatusBadge);
    fixture.componentRef.setInput('status', status);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  async function toneOf(status: string): Promise<string> {
    const badge = (await render(status)).querySelector('qits-badge');
    return badge?.firstElementChild?.className ?? '';
  }

  async function labelOf(status: string): Promise<string> {
    return (await render(status)).textContent ?? '';
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

  it('reads ROLLED_BACK as a warning, because the predecessor kept serving', async () => {
    expect(await toneOf('ROLLED_BACK')).toContain('warning');
  });

  it('reads SUPERSEDED as neutral, because a newer deployment overtook it', async () => {
    expect(await toneOf('SUPERSEDED')).toContain('neutral');
  });

  it('reads GONE as danger, the loudest tone the badge has', async () => {
    expect(await toneOf('GONE')).toContain('danger');
  });

  it('falls back to neutral for a status this build has never heard of', async () => {
    expect(await toneOf('SOMETHING_NEW')).toContain('neutral');
  });

  it('renders the status itself — a coloured dot is not a status', async () => {
    expect(await labelOf('IMAGE_MISSING')).toContain('Image missing');
    expect(await labelOf('ROLLED_BACK')).toContain('Rolled back');
    expect(await labelOf('SUPERSEDED')).toContain('Superseded');
    expect(await labelOf('GONE')).toContain('Gone');
  });

  it('renders the raw word of a status this build has never heard of, never a blank badge', async () => {
    expect(await labelOf('SOMETHING_NEW')).toContain('SOMETHING_NEW');
  });
});
