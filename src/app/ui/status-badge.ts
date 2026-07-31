import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { QitsBadge, type QitsBadgeTone } from '@qits/ui-components';

/**
 * A deployment's status, in the platform's badge.
 *
 * The map is the whole component, and it lives here rather than in the template so that "what
 * colour is IMAGE_MISSING" is answered once. `QitsBadge` takes a *semantic* tone and never a
 * colour, so this is a translation between two vocabularies, not styling.
 *
 * `QUEUED` and `DECOMMISSIONED` share `neutral` deliberately: neither is a problem and neither is a
 * running container, and inventing a distinction the badge does not have would be decoration.
 * `IMAGE_MISSING` is `warning` rather than `danger` because nothing failed here — a build published
 * no image, which is a condition upstream of this deployment rather than a fault in it.
 */
const TONES: Readonly<Record<string, QitsBadgeTone>> = {
  QUEUED: 'neutral',
  STARTING: 'info',
  ACTIVE: 'success',
  IMAGE_MISSING: 'warning',
  FAILED: 'danger',
  DECOMMISSIONED: 'neutral',
};

@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsBadge],
  template: `<qits-badge [label]="status()" [tone]="tone()" />`,
})
export class StatusBadge {
  readonly status = input.required<string>();

  /**
   * `neutral` for a status this build has not been taught. A new enum value must render as a plain
   * badge rather than crash or silently claim success.
   */
  protected readonly tone = computed<QitsBadgeTone>(() => TONES[this.status()] ?? 'neutral');
}
