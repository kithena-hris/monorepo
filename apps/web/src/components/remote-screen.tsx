'use client';

import { createInstance, type ModuleFederation } from '@module-federation/runtime';
import * as Reach from '@reach/ui';
import { Alert, Spinner } from '@reach/ui';
import * as React from 'react';
import {
  Component,
  Suspense,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type JSX,
  type ReactNode,
} from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import * as jsxRuntime from 'react/jsx-runtime';

/*
 * The shell's React and the shell's Reach, offered to every remote.
 *
 * `React` here is the copy Next bundles for the App Router, not the one in
 * `node_modules`, so this is the only way a remote can render with the React
 * that is actually mounted. The remotes are built with `import: false` and
 * carry no copy of their own; this is the one on the page, through
 * federation's share scope. On the server a remote renders in a process of
 * its own, with the same React (`lib/remote-renderer.ts`).
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
 * On the server: the remote's server build, rendered to HTML by a process that
 * holds nothing (PEO-094, PEO-115).
 *
 * Module Federation does not render remotes inside the Next App Router on the
 * server, so the remote publishes `ssr/people.cjs` beside its browser build
 * (`apps/web/people/vite.ssr.config.ts`). The page fetches it and checks it
 * against the signed manifest before it renders (`lib/remote-code.ts`); this
 * asks the renderer process for the screen's HTML (`lib/remote-render.ts`).
 * The shell's own process never evaluates the remote's code, so on the server
 * the remote's host is outside the shell's trust boundary.
 * `PEOPLE_REMOTE_SSR=off` still turns server rendering off.
 *
 * The props cross as JSON. A function cannot, and a render never calls one,
 * so each becomes a marker the renderer turns back into a function that does
 * nothing.
 *
 * The promise is kept for a few seconds so that React, retrying the component
 * once it resolves, finds the same one rather than rendering again.
 */
const FN = '\u0000fn';
type Render = (url: string, component: string, props: string, prefix: string) => Promise<string>;
const rendering = new Map<string, Promise<string>>();

/** The identifiers of a remote's own React root, on the server and in the browser. */
const idPrefix = (name: string): string => `${name}-`;

function serverHtml(name: string, route: RemoteRoute, props: object): Promise<string> {
  if (route.ssr === undefined) throw new Error('server rendering is off; drawn in the browser');
  const render = (globalThis as unknown as Record<symbol, Render | undefined>)[
    Symbol.for('kithena.remote-render')
  ];
  if (render === undefined) throw new Error(`${name} has no renderer; drawn in the browser`);
  const json = JSON.stringify(props, (_key, value: unknown) =>
    typeof value === 'function' ? { [FN]: true } : value,
  );
  const key = `${route.ssr}\n${route.component}\n${json}`;
  let html = rendering.get(key);
  if (html === undefined) {
    html = render(route.ssr, route.component, json, idPrefix(name));
    rendering.set(key, html);
    const forget = (): void => {
      const timer = setTimeout(() => rendering.delete(key), 10_000) as unknown as {
        unref?: () => void;
      };
      timer.unref?.();
    };
    html.then(forget, forget);
  }
  return html;
}

/*
 * In the browser: the server's HTML hydrated by a React root of the remote's
 * own.
 *
 * The HTML came from a tree that is just the screen in a Suspense boundary, so
 * only a root with that same tree hydrates it without a mismatch — `useId`
 * counts from the root. The shell's tree holds the root's container as HTML
 * it does not own, and hands the root its props through a store: an update
 * never reaches a boundary still waiting for the remote's JavaScript, which
 * React would answer by dropping the server's HTML. Until then the screen is
 * on the page, and a press on it is replayed once it hydrates.
 */
interface Current {
  readonly route: RemoteRoute;
  readonly props: Readonly<Record<string, unknown>>;
}

function store(initial: Current) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: (): Current => current,
    set: (next: Current): void => {
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
type Store = ReturnType<typeof store>;

function Hydrated({
  name,
  current,
}: {
  readonly name: string;
  readonly current: Store;
}): JSX.Element {
  const { route, props } = useSyncExternalStore(current.subscribe, current.get, current.get);
  const Screen = use(browserScreenOf(name, route));
  return <Screen {...props} />;
}

const islands = new WeakMap<Element, { root: Root; timer?: ReturnType<typeof setTimeout> }>();

function Island({
  name,
  area,
  route,
  props,
}: {
  readonly name: string;
  readonly area: string;
  readonly route: RemoteRoute;
  readonly props: Readonly<Record<string, unknown>>;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [current] = useState(() => store({ route, props }));
  useLayoutEffect(() => {
    current.set({ route, props });
  });
  useLayoutEffect(() => {
    const container = ref.current;
    if (container === null) return;
    // Development mounts twice; one root per container, whatever React does.
    let island = islands.get(container);
    if (island === undefined) {
      island = {
        root: hydrateRoot(
          container,
          <RemoteBoundary area={area}>
            <Suspense fallback={null}>
              <Hydrated name={name} current={current} />
            </Suspense>
          </RemoteBoundary>,
          { identifierPrefix: idPrefix(name) },
        ),
      };
      islands.set(container, island);
    }
    clearTimeout(island.timer);
    const held = island;
    return () => {
      held.timer = setTimeout(() => {
        islands.delete(container);
        held.root.unmount();
      }, 0);
    };
  }, [area, name, current]);
  return (
    <div
      ref={ref}
      data-remote={name}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: '' }}
    />
  );
}

const subscribeNever = (): (() => void) => () => undefined;

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
  /** The remote's server build, when it verified and the shell may render it. */
  readonly ssr?: string;
  /** Its stylesheet, held to the signed manifest's hash, so the server's HTML paints styled. */
  readonly stylesheet?: { readonly href: string; readonly integrity: string };
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
  /**
   * Follow a link the screen drew, inside this page (the host's router).
   *
   * A remote renders plain `<a href>`s: it cannot know the host's router, and
   * it must work in a host that has none. Without this every one of them was
   * a full page load.
   */
  readonly onNavigate?: (href: string) => void;
}

function Drawn({
  name,
  area,
  route,
  props,
}: {
  readonly name: string;
  readonly area: string;
  readonly route: RemoteRoute;
  readonly props: Readonly<Record<string, unknown>>;
}): JSX.Element {
  // Hydrating means the server sent the screen's HTML; a server that could
  // not left this boundary for the browser to render from nothing.
  const hydrating = useSyncExternalStore(
    subscribeNever,
    () => false,
    () => true,
  );
  const [fromServer] = useState(hydrating);
  if (typeof window === 'undefined') {
    const html = use(serverHtml(name, route, props));
    return <div data-remote={name} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  if (fromServer) return <Island name={name} area={area} route={route} props={props} />;
  const Screen = use(browserScreenOf(name, route));
  // Marked like the server's HTML, so the remote's stylesheet applies here and
  // nowhere else on the page (`apps/web/people/src/contain-utilities.ts`).
  return (
    <div data-remote={name}>
      <Screen {...props} />
    </div>
  );
}

/**
 * Where a press on a remote's link should go without leaving the page: a
 * plain left click on a same-origin link that opens in this tab. `null` for
 * anything the browser should handle itself — a modified click (a new tab),
 * a download, another origin, or a click the screen already handled.
 */
export function inAppHref(event: MouseEvent, origin: string): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
  if (link === null || link.hasAttribute('download')) return null;
  if (link.target !== '' && link.target !== '_self') return null;
  const url = new URL(link.href, origin);
  return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
}

/**
 * A remote's screen, rendered on the server and hydrated in the browser.
 *
 * On the server the screen is drawn by the renderer process from the verified
 * server build and sent in the same response — streamed after the chrome, as
 * Next streams, and revealed by React's inline script before any bundle
 * loads. In the browser the remote's own root keeps that HTML in place until
 * the browser build arrives, then hydrates it (`Island`). The person sees the
 * screen at first paint; it becomes interactive when the remote's JavaScript
 * lands.
 *
 * If the build is missing, unsigned, altered, or fails in the renderer, the
 * error on the server makes React send the spinner for this boundary and
 * render it in the browser instead — the client-only behaviour PEO-094
 * replaced, and nothing worse. The props are the
 * shell's: the data the server fetched and the actions that call People
 * (`people-screen.tsx`). The remote still never fetches.
 */
export function RemoteScreen({
  name,
  area,
  route,
  props = {},
  onNavigate,
}: RemoteScreenProps): JSX.Element {
  const links = useRef<HTMLDivElement>(null);
  // A native listener: the screen hydrates in a React root of its own, whose
  // events this tree's handlers do not see.
  useEffect(() => {
    const container = links.current;
    if (container === null || onNavigate === undefined) return;
    const follow = (event: MouseEvent): void => {
      const href = inAppHref(event, window.location.origin);
      if (href === null) return;
      event.preventDefault();
      onNavigate(href);
    };
    container.addEventListener('click', follow);
    return () => {
      container.removeEventListener('click', follow);
    };
  }, [onNavigate]);
  if (route === null) return <Unavailable area={area} />;
  return (
    <div ref={links} className="contents">
      <RemoteBoundary area={area}>
        {route.stylesheet === undefined ? null : (
          <link
            rel="stylesheet"
            href={route.stylesheet.href}
            integrity={route.stylesheet.integrity}
            crossOrigin="anonymous"
            precedence="default"
          />
        )}
        <Suspense fallback={<Spinner label={`Loading ${area}`} />}>
          <Drawn name={name} area={area} route={route} props={props} />
        </Suspense>
      </RemoteBoundary>
    </div>
  );
}
