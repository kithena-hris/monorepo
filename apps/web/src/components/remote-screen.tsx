'use client';

import { createInstance, type ModuleFederation } from '@module-federation/runtime';
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
import { preloadModule } from 'react-dom';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import * as jsxRuntime from 'react/jsx-runtime';

import { WAITING, releaseEarlyPresses } from '../lib/early-presses';

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
 * The whole of `@reach/ui` is the price of one copy — a remote may use any
 * component, and the shell cannot know which — but only a page with a remote
 * on it pays it: the barrel is imported when federation first asks for it.
 * Imported statically here, it was in a chunk every page under the shell
 * loaded (this file is behind every loading state), rich-text editor and all,
 * on Home and Settings too. The same modules either way: the shell's own
 * imports of single components resolve to the files the barrel re-exports.
 */
const shareConfig = { singleton: true, requiredVersion: false } as const;
let federation: ModuleFederation | undefined;

type Screen = ComponentType<Record<string, unknown>>;

/**
 * What the shell puts in the share scope, each `loaded-first`.
 *
 * A remote registers its own entry for each of these, at the same version,
 * whose `get` only throws (`import: false`). Between two entries at one
 * version, neither loaded, federation keeps the one whose app name sorts
 * later: "timeoff" beat "shell", so the first Time Off screen got the
 * remote's thrower for `@reach/ui` and every page after it on the same load
 * did too ("Time off is unavailable", then People). `loaded-first` is the
 * one rule that keeps the shell's entry whatever the remote is called.
 */
export const shellShared = () =>
  ({
    react: { version: React.version, lib: () => React, shareConfig, strategy: 'loaded-first' },
    'react/jsx-runtime': {
      version: React.version,
      lib: () => jsxRuntime,
      shareConfig,
      strategy: 'loaded-first',
    },
    '@reach/ui': {
      version: '0.0.0',
      get: () => import('@reach/ui').then((reach) => () => reach),
      shareConfig,
      strategy: 'loaded-first',
    },
  }) as const;

function runtime(): ModuleFederation {
  federation ??= createInstance({ name: 'shell', remotes: [], shared: shellShared() });
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
async function browserModule(name: string, entry: string): Promise<Record<string, unknown>> {
  const mf = runtime();
  // On this host (`REMOTE_PATH`): absolute, as federation keys a remote by it.
  mf.registerRemotes([{ name, entry: new URL(entry, window.location.href).href, type: 'module' }]);
  return (await mf.loadRemote<Record<string, unknown>>(name)) ?? {};
}

/** One load per remote build for the life of the page, and what it exported once it has. */
const loading = new Map<string, Promise<Record<string, unknown>>>();
const loaded = new Map<string, Record<string, unknown>>();

function browserModuleOf(name: string, entry: string): Promise<Record<string, unknown>> {
  let promise = loading.get(entry);
  if (promise === undefined) {
    promise = browserModule(name, entry).then((exports) => {
      loaded.set(entry, exports);
      warmWhenIdle(exports);
      return exports;
    });
    loading.set(entry, promise);
    // A failure is the boundary's to draw, and a later visit tries again.
    promise.catch(() => {
      loading.delete(entry);
    });
  }
  return promise;
}

/**
 * The screen a route names: at once when its build has loaded, which every
 * screen after the first finds, so moving between screens never waits or
 * draws a frame of nothing. Before then React waits for it (`use`).
 */
function screenOf(name: string, route: RemoteRoute): Screen {
  return pick(
    loaded.get(route.entry) ?? use(browserModuleOf(name, route.entry)),
    name,
    route.component,
  );
}

/*
 * A remote may put each screen in a chunk of its own, behind a `preload`
 * that resolves once the screen can draw (`apps/web/people/src/split.tsx`).
 * The shell never draws one before then: arriving by a navigation it waits
 * here, outside the stage, so the previous screen stays until the next can
 * draw, and no fallback stands in front of a screen somebody opened.
 *
 * And the chunks are fetched before anybody asks: every screen of a remote
 * once the browser is next idle after its first, and at once when a pointer
 * rests on any in-app link (`warmRemotes`, from `lib/links.ts`), so by the
 * press the screen is here.
 */
type Preload = () => Promise<unknown>;
const preloadOf = (screen: unknown): Preload | undefined => {
  const preload = (screen as { preload?: unknown } | null)?.preload;
  return typeof preload === 'function' ? (preload as Preload) : undefined;
};

function screenReady(name: string, route: RemoteRoute): Screen {
  const screen = screenOf(name, route);
  const preload = preloadOf(screen);
  if (preload !== undefined) use(preload());
  return screen;
}

function warm(exports: Record<string, unknown>): void {
  // Where a page's own code ends and the code for later begins, for a test to tell apart.
  if (performance.getEntriesByName('kithena:warm').length === 0) performance.mark('kithena:warm');
  for (const screen of Object.values(exports)) {
    preloadOf(screen)?.().catch(() => undefined);
  }
}

function warmWhenIdle(exports: Record<string, unknown>): void {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(
      () => {
        warm(exports);
      },
      { timeout: 3000 },
    );
  } else {
    setTimeout(() => {
      warm(exports);
    }, 1000);
  }
}

/** Every loaded remote's screens, fetched now: something on the page is about to open one. */
export function warmRemotes(): void {
  for (const exports of loaded.values()) warm(exports);
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
 * `<env>_REMOTE_SSR=off` (`PEOPLE_REMOTE_SSR=off`) still turns server rendering off.
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

function serverHtml(
  name: string,
  stage: string,
  route: RemoteRoute,
  props: object,
): Promise<string> {
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
    html = render(route.ssr, route.component, json, idPrefix(stage));
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
 * In the browser: the screen in a React root of the remote's own, kept for as
 * long as the person stays in the area — its stage.
 *
 * The first page's HTML came from a tree that is just the screen in a
 * Suspense boundary, so only a root with that same tree hydrates it without a
 * mismatch — `useId` counts from the root. The shell's tree holds the root's
 * container as HTML it does not own, and hands the root its props through a
 * store: an update never reaches a boundary still waiting for the remote's
 * JavaScript, which React would answer by dropping the server's HTML. Until
 * then the screen is on the page, and the shell holds a press on it and
 * replays it once it hydrates (`lib/early-presses.ts`): React itself drops it.
 *
 * And one root for every screen after it. Each page under the shell is
 * thrown away when the address changes (`/people/a` to `/people/b` is a new
 * page), and a root inside the page went with it: the header, its tabs and
 * everything the screen held were drawn again from nothing on every tab,
 * which is what a page that reloads looks like. So the root does not live in
 * the page. Its element moves into whichever page, or loading state, holds
 * the area now, and is told what to show: the same screen with other props
 * is the same screen updated, so its header stays the element it was.
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
      if (next.route === current.route && next.props === current.props) return;
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

function Staged({
  name,
  area,
  current,
  container,
  quiet,
}: {
  readonly name: string;
  readonly area: string;
  readonly current: Store;
  readonly container: Element;
  readonly quiet: boolean;
}): JSX.Element {
  const showing = useSyncExternalStore(current.subscribe, current.get, current.get);
  return (
    <RemoteBoundary
      area={area}
      quiet={quiet}
      showing={showing}
      onFail={() => {
        releaseEarlyPresses(container, false);
      }}
    >
      <Suspense fallback={null}>
        <Shown name={name} container={container} {...showing} />
      </Suspense>
    </RemoteBoundary>
  );
}

function Shown({
  name,
  container,
  route,
  props,
}: Current & { readonly name: string; readonly container: Element }): JSX.Element {
  const Screen = screenOf(name, route);
  // Mounted when the boundary commits its hydration, after the screen's own
  // effects: a press held while the server's HTML waited is answered now.
  // Once only; later screens and moves find nothing waiting.
  useEffect(() => {
    releaseEarlyPresses(container);
  }, [container]);
  return <Screen {...props} />;
}

interface Stage {
  readonly element: HTMLElement;
  readonly root: Root;
  readonly store: Store;
  /** The host it is in now; none between one page leaving and the next arriving. */
  owner: Element | null;
  timer?: ReturnType<typeof setTimeout>;
}

const stages = new Map<string, Stage>();

/**
 * The area's stage, made the first time.
 *
 * Hydrating, it is the element the server's HTML is already in, left where
 * it is: moving those nodes while somebody presses one makes the browser
 * drop the click (the press goes down on one parent and up on another), and
 * a press held before hydration (`lib/early-presses.ts`) is held on this
 * element. It moves only when a later page takes it. Drawn from nothing, it is
 * an element of its own. Either way `display: contents`, so the screen lays
 * out as if it were the host's own child.
 */
function stageOf(
  name: string,
  stageKey: string,
  area: string,
  container: HTMLElement,
  current: Current,
  hydrate: boolean,
): Stage {
  const kept = stages.get(stageKey);
  if (kept !== undefined && !hydrate) return kept;
  // A second page from the server in one document has no stage to keep.
  if (kept !== undefined) {
    setTimeout(() => {
      kept.root.unmount();
    }, 0);
  }
  const element = hydrate ? container : document.createElement('div');
  element.style.display = 'contents';
  const state = store(current);
  const tree = (
    <Staged name={name} area={area} current={state} container={element} quiet={stageKey !== name} />
  );
  const options = { identifierPrefix: idPrefix(stageKey) };
  let root: Root;
  if (hydrate) {
    root = hydrateRoot(element, tree, options);
  } else {
    // Asked for during the shell's commit, so it is drawn before the frame is
    // painted, never a frame later.
    root = createRoot(element, options);
    root.render(tree);
  }
  const stage: Stage = { element, root, store: state, owner: null };
  stages.set(stageKey, stage);
  return stage;
}

/** Where the area's stage is on this page. */
function Host({
  name,
  stage: stageKey,
  area,
  route,
  props,
  hydrate,
}: {
  readonly name: string;
  /** The stage's key: the area's name, or a place in the shell's chrome (`RemoteScreen`'s `slot`). */
  readonly stage: string;
  readonly area: string;
  readonly route: RemoteRoute;
  readonly props: Readonly<Record<string, unknown>>;
  /** The server sent the screen's HTML into this element, for the stage to hydrate. */
  readonly hydrate: boolean;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef<Current>({ route, props });
  useLayoutEffect(() => {
    latest.current = { route, props };
  });
  useLayoutEffect(() => {
    const container = ref.current;
    if (container === null) return;
    const stage = stageOf(name, stageKey, area, container, latest.current, hydrate);
    clearTimeout(stage.timer);
    if (stage.element !== container && stage.element.parentNode !== container) {
      container.append(stage.element);
    }
    stage.owner = container;
    return () => {
      if (stage.owner !== container) return;
      stage.owner = null;
      // Left the area, unless another host takes the stage in this same commit.
      stage.timer = setTimeout(() => {
        if (stage.owner !== null || stages.get(stageKey) !== stage) return;
        stages.delete(stageKey);
        stage.root.unmount();
      }, 0);
    };
  }, [name, stageKey, area, hydrate]);
  useLayoutEffect(() => {
    stages.get(stageKey)?.store.set({ route, props });
  });
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
  {
    readonly area: string;
    /** A place in the shell's chrome: down, it is nothing rather than a message. */
    readonly quiet?: boolean;
    /** What it shows: anything else to show tries again, as a new page once did. */
    readonly showing?: unknown;
    readonly onFail?: () => void;
    readonly children: ReactNode;
  },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidUpdate(previous: Readonly<{ showing?: unknown }>): void {
    if (this.state.failed && previous.showing !== this.props.showing) {
      this.setState({ failed: false });
    }
  }

  override componentDidCatch(): void {
    this.props.onFail?.();
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return this.props.quiet === true ? null : <Unavailable area={this.props.area} />;
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
   * What stands in for the screen while it is drawn in the browser rather
   * than by the server: a skeleton of its shape. A spinner when absent.
   */
  readonly fallback?: ReactNode;
  /**
   * A place in the shell's own chrome the remote fills (`topBar`) rather
   * than the page: a stage of its own beside the area's screen, which may be
   * on the page at the same time, and nothing at all, never a message, when
   * the remote cannot be reached.
   */
  readonly slot?: string;
}

function Drawn({
  name,
  stage,
  area,
  route,
  props,
}: {
  readonly name: string;
  readonly stage: string;
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
    const html = use(serverHtml(name, stage, route, props));
    // Waiting for the remote's code: a press here is held until it hydrates.
    return (
      <div data-remote={name} {...{ [WAITING]: '' }} dangerouslySetInnerHTML={{ __html: html }} />
    );
  }
  // Drawn from nothing, its code is waited for here, so the stage never draws
  // a frame of nothing while it loads; this boundary's skeleton stands in.
  if (!fromServer) screenReady(name, route);
  // Marked like the server's HTML, so the remote's stylesheet applies here and
  // nowhere else on the page (`apps/web/people/src/contain-utilities.ts`).
  return (
    <Host name={name} stage={stage} area={area} route={route} props={props} hydrate={fromServer} />
  );
}

/**
 * Arriving by a navigation, the screen's code is waited for here, above the
 * screen's own boundary rather than inside it.
 *
 * A navigation is a transition, and a transition keeps what is on screen
 * until the next screen can be drawn — unless something new shows a
 * fallback. The screen's boundary is new with every screen (the page under
 * the shell is), so a screen whose code had not loaded yet swapped the page
 * for a spinner and then for the screen: a blink on every first visit.
 * Waited for up here, the previous screen stays until this one is ready.
 *
 * Not while hydrating: the server's HTML is already the screen, and the
 * boundary keeps it there until the code arrives (`Host`). Inside
 * `RemoteBoundary`, so a remote that cannot be reached still says so.
 */
function Loaded({
  name,
  route,
  children,
}: {
  readonly name: string;
  readonly route: RemoteRoute;
  readonly children: ReactNode;
}): ReactNode {
  screenReady(name, route);
  return children;
}

/**
 * A remote's screen, rendered on the server and hydrated in the browser.
 *
 * On the server the screen is drawn by the renderer process from the verified
 * server build and sent in the same response — streamed after the chrome, as
 * Next streams, and revealed by React's inline script before any bundle
 * loads. In the browser the remote's own root keeps that HTML in place until
 * the browser build arrives, then hydrates it (`Host`). The person sees the
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
  fallback,
  slot,
}: RemoteScreenProps): JSX.Element | null {
  const hydrating = useSyncExternalStore(
    subscribeNever,
    () => false,
    () => true,
  );
  // Latched like `Drawn`'s, so the render after hydration does not start waiting.
  const [arrived] = useState(!hydrating);
  if (route === null) return slot === undefined ? <Unavailable area={area} /> : null;
  const stage = slot === undefined ? name : `${name}-${slot}`;
  // Fetched beside the shell's own bundle rather than after it has hydrated.
  preloadModule(route.entry);
  const screen = (
    <Suspense
      fallback={
        fallback === undefined && slot === undefined ? (
          <Spinner label={`Loading ${area}`} />
        ) : (
          fallback
        )
      }
    >
      <Drawn name={name} stage={stage} area={area} route={route} props={props} />
    </Suspense>
  );
  return (
    <RemoteBoundary area={area} quiet={slot !== undefined}>
      {route.stylesheet === undefined ? null : (
        <link
          rel="stylesheet"
          href={route.stylesheet.href}
          integrity={route.stylesheet.integrity}
          crossOrigin="anonymous"
          precedence="default"
        />
      )}
      {arrived ? (
        <Loaded name={name} route={route}>
          {screen}
        </Loaded>
      ) : (
        screen
      )}
    </RemoteBoundary>
  );
}
