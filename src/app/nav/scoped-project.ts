import { computed, inject, type Signal } from '@angular/core';
import { QITS_PROJECTS, QITS_SCOPE, scopeCommands, type QitsScope } from '@qits/ui-components';

/** What a page needs to know about the project in the address: what it is, and how to link inside it. */
export interface ScopedProject {
  /** The scope the address states — empty outside a project. */
  readonly scope: Signal<QitsScope>;
  /** Router commands an in-app absolute link starts with, so the link stays in the scope on screen. */
  readonly commands: Signal<readonly string[]>;
  /** The project's name, its slug until the list answers, and `undefined` outside a project. */
  readonly name: Signal<string | undefined>;
}

/**
 * The project the address names, for a page that has a header to say it in.
 *
 * Both tokens are optional on purpose. The chrome provides them in the application; a spec about
 * one page's table does not have to install a scope and a project list to render it, and gets the
 * unscoped answer — which is exactly what the same page shows at `/`.
 *
 * The name comes from `QITS_PROJECTS` by **slug**, because the slug is what the URL carries and the
 * id is what the API takes. Falling back to the slug keeps the header honest during the one paint
 * before the project list answers, rather than blanking and then appearing.
 */
export function injectScopedProject(): ScopedProject {
  const source = inject(QITS_SCOPE, { optional: true });
  const projects = inject(QITS_PROJECTS, { optional: true });
  const scope = computed<QitsScope>(() => source?.scope() ?? {});
  return {
    scope,
    commands: computed(() => scopeCommands(scope())),
    name: computed(() => {
      const slug = scope().project;
      if (!slug) return undefined;
      return projects?.projects()?.find((project) => project.slug === slug)?.name ?? slug;
    }),
  };
}
