import { Alert, Button, Spinner } from '@reach/ui';
import type { JSX, ReactNode } from 'react';

/**
 * What the shell hands a screen: the data, or why there is none yet.
 *
 * The shell fetches and the remote draws (`docs/build-plan.md`, "Remotes are
 * dumb"), so a screen never learns how its data arrived — only which of these
 * three states it is in. `retry` is the shell's to supply; without it the error
 * says so and offers nothing to press.
 */
export type Loadable<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string; readonly retry?: () => void }
  | { readonly status: 'ready'; readonly data: T };

/** Every screen's three states, drawn the same way everywhere. */
export function Loaded<T>({
  load,
  what,
  children,
}: {
  readonly load: Loadable<T>;
  /** "the employee fields", for "Loading the employee fields". */
  readonly what: string;
  readonly children: (data: T) => ReactNode;
}): JSX.Element {
  if (load.status === 'loading') return <Spinner label={`Loading ${what}`} />;
  if (load.status === 'error') {
    return (
      <Alert
        tone="danger"
        title={`Could not load ${what}`}
        action={
          load.retry === undefined ? undefined : (
            <Button size="sm" onClick={load.retry}>
              Try again
            </Button>
          )
        }
      >
        {load.message}
      </Alert>
    );
  }
  return <>{children(load.data)}</>;
}

/** What every async action a screen is handed resolves to. */
export type Outcome = { readonly ok: true } | { readonly ok: false; readonly message: string };
