'use client';

import { createInstance, type ModuleFederation } from '@module-federation/runtime';
import * as Reach from '@reach/ui';
import { Alert, Spinner } from '@reach/ui';
import * as React from 'react';
import { Component, Suspense, use, type ComponentType, type JSX, type ReactNode } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';

/*
 * The shell's React and the shell's Reach, offered to every remote.
 *
 * `React` here is the copy Next bundles for the App Router, not the one in
 * `node_modules`, so this is the only way a remote can render with the React
 * that is actually mounted. The remotes are built with `import: false` and
 * carry no copy of their own; this is the one on the page — in the browser
 * through federation's share scope, and on the server through `serverScreen`.
 *
 * Importing the whole of `@reach/ui` puts the barrel in this chunk. It is the
 * price of one copy — a remote may use any component, and the shell cannot
 * know which.
 */
const shareConfig = { singleton: true, requiredVersion: false } as const;
let federation: ModuleFederation | undefined;

type Screen = ComponentType<Record<string, unknown>>;

function runtime(): ModuleFederation {
  federation ??= createInstance({
    name: 'shell',
    remotes: [],
    shared: {
      react: { version: React.version, lib: () => React, shareConfig },
      'react/jsx-runtime': { version: React.version, lib: () => jsxRuntime, shareConfig },
      '@reach/ui': { version: '0.0.0', lib: () => Reach, shareConfig },
    },
  });
  return federation;
}

function pick(
  exports: Record<string, unknown> | null | undefined,
  name: string,
  component: string,
): Screen {
  const screen = exports?.[component];
  if (typeof screen !== 'function') throw new Error(`${name} does not export ${component}`);
  return screen as Screen;
}

/** In the browser: federation, from `remoteEntry.js`. */
async function browserScreen(name: string, entry: string, component: string): Promise<Screen> {
  const mf = runtime();
  mf.registerRemotes([{ name, entry, type: 'module' }]);
  return pick(await mf.loadRemote<Record<string, unknown>>(name), name, component);
}

const loading = new Map<string, Promise<Screen>>();

/** One promise per remote and screen, for the life of the page. */
function browserScreenOf(name: string, route: RemoteRoute): Promise<Screen> {
  const key = `${route.entry} ${route.component}`;
  let promise = loading.get(key);
  if (promise === undefined) {
    promise = browserScreen(name, route.entry, route.component);
    loading.set(key, promise);
    // A failure is the boundary's to draw, and a later visit tries again.
    promise.catch(() => {
      loading.delete(key);
    });
  }
  return promise;
}

/*
 * On the server: the remote's server build, evaluated against the shell's own
 * React, JSX runtime and Reach (PEO-094).
 *
 * Module Federation does not render remotes inside the Next App Router on the
 * server — `@module-federation/nextjs-mf` never supported it and is being
 * wound down — so the remote publishes `ssr/people.cjs` beside its browser
 * build (`apps/web/people/vite.ssr.config.ts`). The page fetches it before it
 * renders (`lib/remote-code.ts`) and this evaluates it. That is what
 * federation's own Node runtime does: fetch the remote's code and evaluate it
 * in-process, with the host's shared modules handed in.
 *
 * **The trust this takes, stated plainly.** Evaluating the remote's code here
 * runs it with this server's privileges, which include the internal token. So
 * the remote's host is inside the shell's trust boundary, as a dependency
 * would be. The address is server configuration (`PEOPLE_REMOTE_URL`) and
 * never comes from a request, and the code is only ever what that host
 * serves. A deployment that does not accept that sets `PEOPLE_REMOTE_SSR=off`
 * and gets the client-rendered page (the spinner, then the screen).
 *
 * The code is fetched per request, so a redeploy of the remote alone changes
 * the next page — the PEO-046 property, kept on the server. It is evaluated
 * again only when the file changed.
 */
const SHARED: Readonly<Record<string, unknown>> = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  '@reach/ui': Reach,
};
let evaluated: { code: string; exports: Record<string, unknown> } | undefined;

/** The screen from the server build the page fetched; an error sends it to the browser. */
function serverScreen(name: string, route: RemoteRoute): Screen {
  if (route.ssr === undefined) throw new Error('server rendering is off; drawn in the browser');
  const store = (globalThis as unknown as Record<symbol, Map<string, string> | undefined>)[
    Symbol.for('kithena.remote-code')
  ];
  const code = store?.get(route.ssr);
  if (code === undefined) {
    throw new Error(`${name}'s server build is not available; drawn in the browser`);
  }
  if (evaluated?.code !== code) {
    const module: { exports: Record<string, unknown> } = { exports: {} };
    const require = (id: string): unknown => {
      if (!Object.hasOwn(SHARED, id)) {
        throw new Error(`${name} asked for ${id}, which the shell does not share`);
      }
      return SHARED[id];
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the remote's own build, by design; see above.
    const evaluate = new Function('require', 'module', 'exports', code) as (
      require: (id: string) => unknown,
      module: { exports: Record<string, unknown> },
      exports: Record<string, unknown>,
    ) => void;
    evaluate(require, module, module.exports);
    evaluated = { code, exports: module.exports };
  }
  return pick(evaluated.exports, name, route.component);
}

function Unavailable({ area }: { readonly area: string }): JSX.Element {
  return (
    <Alert tone="danger" title={`${area} is unavailable`}>
      This part of the app could not be loaded. The rest still works; try again in a minute.
    </Alert>
  );
}

/** A remote that loads and then throws is as down as one that never loaded. */
class RemoteBoundary extends Component<
  { readonly area: string; readonly children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? <Unavailable area={this.props.area} /> : this.props.children;
  }
}

export interface RemoteRoute {
  readonly entry: string;
  readonly component: string;
  /** The remote's server build, when the shell may render it (`ssr/people.cjs`). */
  readonly ssr?: string;
  /** Its stylesheet, linked so the server's HTML paints styled. */
  readonly stylesheet?: string;
}

export interface RemoteScreenProps {
  /** The federation name the remote was built with. */
  readonly name: string;
  /** Shown in the message when it cannot be reached. */
  readonly area: string;
  /** Where to load it from, or null when the shell already knows it is down. */
  readonly route: RemoteRoute | null;
  /** What the screen is drawn from and what its buttons do, from the shell (PEO-098). */
  readonly props?: Readonly<Record<string, unknown>>;
}

function Drawn({
  name,
  route,
  props,
}: {
  readonly name: string;
  readonly route: RemoteRoute;
  readonly props: Readonly<Record<string, unknown>>;
}): JSX.Element {
  // On the server, synchronously from the code the page fetched. In the
  // browser, `use()` holds the server's HTML until federation has loaded.
  const Screen =
    typeof window === 'undefined' ? serverScreen(name, route) : use(browserScreenOf(name, route));
  return <Screen {...props} />;
}

/**
 * A remote's screen, rendered on the server and hydrated in the browser.
 *
 * On the server the screen is drawn from the remote's server build and sent in
 * the same response — streamed after the chrome, as Next streams, and
 * revealed by React's inline script before any bundle loads. In the browser, hydration reaches `use()` with
 * federation still loading, so React keeps the server's HTML in place — a
 * Suspense boundary that is not yet hydrated — until the browser build
 * arrives, then hydrates it. The person sees the screen at first paint; it
 * becomes interactive when the remote's JavaScript lands.
 *
 * If the server build is missing, the error on the server makes React send
 * the spinner for this boundary and render it in the browser instead — the
 * client-only behaviour this replaced, and nothing worse. The props are the
 * shell's: the data the server fetched and the actions that call People
 * (`people-screen.tsx`). The remote still never fetches.
 */
export function RemoteScreen({ name, area, route, props = {} }: RemoteScreenProps): JSX.Element {
  if (route === null) return <Unavailable area={area} />;
  return (
    <RemoteBoundary area={area}>
      {route.stylesheet === undefined ? null : (
        <link rel="stylesheet" href={route.stylesheet} precedence="default" />
      )}
      <Suspense fallback={<Spinner label={`Loading ${area}`} />}>
        <Drawn name={name} route={route} props={props} />
      </Suspense>
    </RemoteBoundary>
  );
}
