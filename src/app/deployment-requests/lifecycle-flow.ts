import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * How far a version got, at one tile.
 *
 * Three words and no fourth, because the reader's question has three answers: it happened, it has
 * not happened yet, or it was going to happen and stopped. `stopped` is the one that earns its
 * place — an in-flight tile and a rolled-back one look identical if the only vocabulary is
 * reached/not-reached, and the difference between them is the whole reason somebody opened this
 * page.
 */
export type LifecycleState = 'reached' | 'pending' | 'stopped';

/** One tile of the flow: what the step is, what it says, and whether it happened. */
export interface LifecycleStage {
  /** Stable across polls, so a tile is not rebuilt every six seconds. */
  readonly id: string;
  readonly title: string;
  /** The one line under the title — a version, a tier, a timestamp. */
  readonly meta: string;
  readonly state: LifecycleState;
  /** Why a `stopped` tile stopped, in the server's own word. Drawn only where there is one. */
  readonly detail?: string;
}

/**
 * A version's journey, left to right.
 *
 * **It renders and decides nothing.** Every stage — how many there are, what each says, and whether
 * it was reached — is computed by the page that owns the data, and this component is handed the
 * finished array. That split is deliberate rather than tidy: "is this version running in dev" is a
 * question about the newest ACTIVE deployment of an (application, tier) pair, and a presentational
 * component that answered it would need the deployment list, the environment list and the request,
 * which is the page's whole state passed down one level to be re-derived.
 *
 * The consequence worth keeping: this component has no API, no injection and no signals of its own,
 * so it can be asserted with a literal array and the page's rules can be asserted without a DOM.
 *
 * The tones are quiet on purpose. A pending stage is neutral rather than a spinner — a release
 * waiting on a merge is not a problem, and half the tiles on a healthy page are pending. A stopped
 * one is the only tile that raises its voice, and it says the status word rather than a colour.
 */
@Component({
  selector: 'app-lifecycle-flow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="flow">
      @for (stage of stages(); track stage.id; let last = $last) {
        <li class="stage" [class]="stage.state">
          <div class="tile">
            <span class="mark" aria-hidden="true">{{ mark(stage.state) }}</span>
            <span class="title">{{ stage.title }}</span>
            <span class="meta">{{ stage.meta }}</span>
            @if (stage.detail) {
              <span class="detail">{{ stage.detail }}</span>
            }
            <span class="sr">{{ reading(stage.state) }}</span>
          </div>
          @if (!last) {
            <span class="arrow" aria-hidden="true">→</span>
          }
        </li>
      }
    </ol>
  `,
  styles: `
    :host {
      display: block;
    }
    .flow {
      display: flex;
      align-items: stretch;
      flex-wrap: wrap;
      gap: 0.4rem;
      list-style: none;
      margin: 0.5rem 0 1rem;
      padding: 0;
    }
    .stage {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .tile {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      min-width: 9rem;
      padding: 0.5rem 0.7rem;
      border: 1px solid #e5e7eb;
      border-radius: 0.375rem;
      background: #fff;
    }
    /* Subtle, never a celebration: most of a healthy page is reached tiles. */
    .stage.reached .tile {
      border-color: #a7f3d0;
      background: #f0fdf4;
    }
    /* Muted, and the status word beside it is what actually says something. */
    .stage.stopped .tile {
      border-color: #fde68a;
      background: #fffbeb;
    }
    .mark {
      font-size: 0.8rem;
      color: #6b7280;
    }
    .stage.reached .mark {
      color: #047857;
    }
    .stage.stopped .mark {
      color: #92400e;
    }
    .title {
      font-weight: 600;
      color: #111827;
    }
    .meta {
      color: #6b7280;
      font-size: 0.85rem;
    }
    .detail {
      color: #92400e;
      font-size: 0.85rem;
    }
    .arrow {
      color: #9ca3af;
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class LifecycleFlow {
  /** The stages, in order. The caller owns both the order and the verdicts. */
  readonly stages = input.required<readonly LifecycleStage[]>();

  /** A glyph, never the only carrier of the state — the tile is tinted and the label is read out. */
  protected mark(state: LifecycleState): string {
    if (state === 'reached') return '✓';
    return state === 'stopped' ? '⚠' : '·';
  }

  /** What a screen reader is told, because a tint and a glyph are not a sentence. */
  protected reading(state: LifecycleState): string {
    if (state === 'reached') return 'reached';
    return state === 'stopped' ? 'stopped' : 'not yet';
  }
}
