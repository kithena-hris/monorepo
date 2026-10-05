import { use, type ComponentType, type JSX } from 'react';

import { framed, type Frame } from './frame';

/**
 * A screen in a chunk of its own, for the browser build (`index.browser.ts`).
 *
 * The remote used to be one file: every screen's code fetched and compiled
 * before the first one could hydrate. Now the first screen's chunk is the only
 * one the page waits for, and the rest arrive when the browser is idle or a
 * pointer rests on a link to one (the shell calls `preload`, `remote-screen.tsx`).
 *
 * `preload` returns the same promise every time, and marks it fulfilled the
 * way React's `use` reads one, so a screen already here renders at once:
 * the shell waits on it before it moves the stage to a new screen, so the
 * old screen stays until the new one can draw and nothing blinks. During
 * hydration a screen still on its way leaves the server's HTML in place
 * until it lands, which React does for a component that suspends there.
 *
 * The server build and the tests import `index.ts`, where every screen is
 * there from the start: the renderer draws in one synchronous pass.
 */
type Props = Record<string, unknown> & { readonly frame?: Frame };
type Loading = Promise<void>;

export type SplitScreen = ComponentType<Props> & { readonly preload: () => Promise<void> };

export function split<M>(load: () => Promise<M>, name: keyof M & string): SplitScreen {
  let Screen: ComponentType<Props> | undefined;
  let loading: Loading | undefined;
  const preload = (): Loading => {
    loading ??= load().then(
      (module) => {
        Screen = framed(module[name] as ComponentType<Props>);
        if (loading !== undefined)
          Object.assign(loading, { status: 'fulfilled', value: undefined });
      },
      (error: unknown) => {
        // Tried again by the next render or hover, rather than failed for good.
        loading = undefined;
        throw error;
      },
    );
    return loading;
  };
  function Split(props: Props): JSX.Element {
    if (Screen === undefined) use(preload());
    const Shown = Screen as ComponentType<Props>;
    return <Shown {...props} />;
  }
  Split.displayName = `Split(${name})`;
  return Object.assign(Split, { preload });
}
