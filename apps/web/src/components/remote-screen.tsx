'use client';

import { createInstance, type ModuleFederation } from '@module-federation/runtime';
import * as Reach from '@reach/ui';
import { Alert, Spinner } from '@reach/ui';
import * as React from 'react';
import {
  Component,
  useEffect,
  useState,
  type ComponentType,
  type JSX,
  type ReactNode,
} from 'react';
import * as jsxRuntime from 'react/jsx-runtime';

/*
 * The shell's React and the shell's Reach, offered to every remote.
 *
 * `React` here is the copy Next bundles for the App Router, not the one in
 * `node_modules`, so this is the only way a remote can render with the React
 * that is actually mounted. The remotes are built with `import: false` and
 * carry no copy of their own; this is the one on the page.
 *
 * Importing the whole of `@reach/ui` puts the barrel in this chunk. It is the
 * price of one copy — a remote may use any component, and the shell cannot
 * know which.
 */
const shareConfig = { singleton: true, requiredVersion: false } as const;
let federation: ModuleFederation | undefined;

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

async function loadScreen(
  name: string,
  entry: string,
  component: string,
): Promise<ComponentType<Record<string, unknown>>> {
  const mf = runtime();
  mf.registerRemotes([{ name, entry, type: 'module' }]);
  const exports = await mf.loadRemote<Record<string, unknown>>(name);
  const screen = exports?.[component];
  if (typeof screen !== 'function') throw new Error(`${name} does not export ${component}`);
  return screen as ComponentType<Record<string, unknown>>;
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

export interface RemoteScreenProps {
  /** The federation name the remote was built with. */
  readonly name: string;
  /** Shown in the message when it cannot be reached. */
  readonly area: string;
  /** Where to load it from, or null when the shell already knows it is down. */
  readonly route: { readonly entry: string; readonly component: string } | null;
  /** What the screen is drawn from and what its buttons do, from the shell (PEO-098). */
  readonly props?: Readonly<Record<string, unknown>>;
}

type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; Screen: ComponentType<Record<string, unknown>> }
  | { status: 'failed' };

/**
 * A remote's screen, loaded in the browser at runtime.
 *
 * Client-only. The server and the first client render both show the spinner,
 * so there is nothing to mismatch on hydration; the remote arrives after. Its
 * props are the shell's: the data the server fetched and the actions that
 * call People (`people-screen.tsx`). The remote still never fetches.
 */
export function RemoteScreen({ name, area, route, props = {} }: RemoteScreenProps): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const entry = route?.entry;
  const component = route?.component;

  useEffect(() => {
    if (entry === undefined || component === undefined) return;
    let current = true;
    setLoaded({ status: 'loading' });
    loadScreen(name, entry, component).then(
      (Screen) => {
        if (current) setLoaded({ status: 'ready', Screen });
      },
      () => {
        if (current) setLoaded({ status: 'failed' });
      },
    );
    return () => {
      current = false;
    };
  }, [name, entry, component]);

  if (route === null || loaded.status === 'failed') return <Unavailable area={area} />;
  if (loaded.status === 'loading') return <Spinner label={`Loading ${area}`} />;
  return (
    <RemoteBoundary area={area}>
      <loaded.Screen {...props} />
    </RemoteBoundary>
  );
}
