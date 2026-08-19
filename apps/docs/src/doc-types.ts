/**
 * The shapes a documentation page is made of.
 *
 * Their own module because the registries import each other's contents and
 * would otherwise import each other's *types* back out of `registry.tsx`,
 * which is a cycle. Dependency-cruiser counts type-only edges here
 * (`tsPreCompilationDeps`), and it is right to: a cycle that exists only in the
 * type graph still means no file in it can be read on its own.
 */

import type { JSX, ReactNode } from 'react';

/** One prop row in a page's API table. */
export interface PropRow {
  readonly name: string;
  readonly type: string;
  readonly default?: string;
  readonly description: string;
}

/** A titled block: a live example, its source, and optionally a note. */
export interface Section {
  readonly id: string;
  readonly title: string;
  readonly blurb?: string;
  /**
   * The example, as a component rather than a function returning markup.
   *
   * Several Reach controls are controlled by design, `Combobox`, `PinInput`,
   * `TagsInput`, `NumberField`, take a value and an onChange and hold no state
   * of their own. Demonstrating one honestly needs `useState`, and a plain
   * `() => ReactNode` called during render cannot hold a hook.
   */
  readonly render: () => JSX.Element;
  readonly code: string;
  /**
   * Examples that open a layer (a dialog, a sheet) need room below the trigger
   * or the preview clips them. Set when the example is taller than a control.
   */
  readonly tall?: boolean;
}

export interface DocPage {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  /** The one-line rule that decides whether this is the right component. */
  readonly when?: string;
  readonly importLine: string;
  readonly sections: readonly Section[];
  readonly props?: readonly PropRow[];
}

export interface NavGroup {
  readonly title: string;
  readonly slugs: readonly string[];
}

export type { ReactNode as DocNode };
