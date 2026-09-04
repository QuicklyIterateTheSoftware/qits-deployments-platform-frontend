import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { QitsBadge, type QitsBadgeTone } from '@qits/ui-components';

/**
 * A deployment's status, in the platform's badge.
 *
 * The map is the whole component, and it lives here rather than in the template so that "what
 * colour is IMAGE_MISSING" is answered once. `QitsBadge` takes a *semantic* tone and never a
 * colour, so this is a translation between two vocabularies, not styling.
 *
 * `QUEUED`, `DECOMMISSIONED` and `SUPERSEDED` share `neutral` deliberately: none is a problem and
 * none is a running container, and inventing a distinction the badge does not have would be
 * decoration. `IMAGE_MISSING` is `warning` rather than `danger` because nothing failed here — a
 * build published no image, which is a condition upstream of this deployment rather than a fault in
 * it. `SPEC_UNREADABLE` is `warning` on the same argument and one step further: the git host would
 * not serve the file that says where this release goes, nothing about the repository is being
 * claimed, and the deployer is reading it again — a `danger` badge would page somebody for a
 * condition that is usually over in thirty seconds. `ROLLED_BACK` is `warning` for the mirror image
 * of that reason: the update failed, but the orchestrator put the predecessor back and the service
 * never stopped serving.
 *
 * `SCALED_TO_ZERO` is `warning` and reads **Stopped**, which is the one place this map makes a
 * judgement rather than a translation. It is not `danger`: somebody stopped this application on
 * purpose and answering their own action with a red badge would train a reader to skim past the
 * colour that means an outage. It is not `neutral` either, because a stopped application is not
 * serving and a table where that looks like ordinary history is a table that hides an outage
 * somebody forgot to end. The word is `Stopped` rather than `Scaled to zero` because the reader is
 * an operator asking whether the thing is running, not a person reading a replica count.
 *
 * `GONE` shares `danger` with `FAILED`, and that is the badge's vocabulary rather than a claim that
 * the two are the same thing. A deployment whose container vanished after it was serving wants
 * attention exactly as loudly as one that never started; `QitsBadgeTone` has five tones and no sixth
 * one to draw the difference with, and a tone that undersold it would be worse than a shared one.
 */
const TONES: Readonly<Record<string, QitsBadgeTone>> = {
  QUEUED: 'neutral',
  STARTING: 'info',
  ACTIVE: 'success',
  IMAGE_MISSING: 'warning',
  SPEC_UNREADABLE: 'warning',
  ROLLED_BACK: 'warning',
  FAILED: 'danger',
  GONE: 'danger',
  SCALED_TO_ZERO: 'warning',
  DECOMMISSIONED: 'neutral',
  SUPERSEDED: 'neutral',
};

/**
 * The word a person reads, for the statuses whose wire spelling is not one.
 *
 * The wire spellings are shouted and some of them are two words joined by an underscore, which is a
 * database's punctuation and not a reader's. The map covers every status this build knows so the
 * column does not mix `ACTIVE` with `Rolled back`; a status it has not been taught renders its raw
 * word, which is legible and is the honest thing to show.
 */
const LABELS: Readonly<Record<string, string>> = {
  QUEUED: 'Queued',
  STARTING: 'Starting',
  ACTIVE: 'Active',
  IMAGE_MISSING: 'Image missing',
  SPEC_UNREADABLE: 'Spec unreadable',
  ROLLED_BACK: 'Rolled back',
  FAILED: 'Failed',
  GONE: 'Gone',
  SCALED_TO_ZERO: 'Stopped',
  DECOMMISSIONED: 'Decommissioned',
  SUPERSEDED: 'Superseded',
};

@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QitsBadge],
  template: `<qits-badge [label]="label()" [tone]="tone()" />`,
})
export class StatusBadge {
  readonly status = input.required<string>();

  /**
   * `neutral` for a status this build has not been taught. A new enum value must render as a plain
   * badge rather than crash or silently claim success.
   */
  protected readonly tone = computed<QitsBadgeTone>(() => TONES[this.status()] ?? 'neutral');

  /** The raw word for a status this build has not been taught — never an empty badge. */
  protected readonly label = computed<string>(() => LABELS[this.status()] ?? this.status());
}
