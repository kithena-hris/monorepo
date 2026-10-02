'use client';

import {
  Alert,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  EmptyState,
  PageHeader,
  Spinner,
  TertiaryNav,
} from '@reach/ui';
import { useRouter } from 'next/navigation';
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type JSX,
  type ReactNode,
} from 'react';

import { SLOW_AFTER_MS, retryDelay } from '../lib/waking';

/**
 * In place of a page's body while the VM behind it wakes (`lib/waking.ts`),
 * and the body itself once it has.
 *
 * Wraps the body on every render, waking or not, so it is the same element
 * across `router.refresh()`: it keeps its clock and its attempts, and when the
 * server's next answer is the page, it shows it in place — no reload, the
 * address as it was — and says so in its live region. Nothing else in it is
 * live: the elapsed time and each retry are silent; only "taking longer" (an
 * alert of its own) and "ready" are said.
 *
 * It asks the server for the page again after 2 s, 3 s, 5 s, then every 5 s,
 * one at a time; not while the tab is hidden; and not after three minutes,
 * when it says so and offers Try again. A real error is a page of its own, so
 * the server's answer stops it too. Waking the VM is the server's: every read
 * that finds it asleep asks EC2 (`lib/people.ts`).
 */

const subscribeVisibility = (changed: () => void): (() => void) => {
  document.addEventListener('visibilitychange', changed);
  return () => {
    document.removeEventListener('visibilitychange', changed);
  };
};

const elapsed = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
};

export function Waking({
  area,
  waking,
  header,
  children,
}: {
  /** What is waking, as the title says it: "People". */
  readonly area: string;
  readonly waking: boolean;
  /** Drawn above the waking state only: the page's own header, when the body would have drawn it. */
  readonly header?: ReactNode;
  readonly children?: ReactNode;
}): JSX.Element {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const shown = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== 'hidden',
    () => true,
  );
  // Set in the browser only, so the server's HTML and the first render agree.
  const [began, setBegan] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const wasWaking = useRef(waking);
  const slow = began !== null && now - began >= SLOW_AFTER_MS;

  useEffect(() => {
    if (wasWaking.current && !waking) setReady(true);
    // First seen waking, or asleep again after it was ready: the clock starts over.
    if (waking && (began === null || !wasWaking.current)) {
      setBegan(Date.now());
      setNow(Date.now());
      setAttempt(0);
      setReady(false);
    }
    wasWaking.current = waking;
  }, [waking, began]);

  // The clock, while it waits.
  useEffect(() => {
    if (!waking || slow) return undefined;
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(tick);
    };
  }, [waking, slow]);

  // The next ask, once the last one has answered.
  useEffect(() => {
    if (!waking || slow || pending || !shown) return undefined;
    const timer = setTimeout(() => {
      setAttempt((n) => n + 1);
      startTransition(() => {
        router.refresh();
      });
    }, retryDelay(attempt));
    return () => {
      clearTimeout(timer);
    };
  }, [waking, slow, pending, shown, attempt, router]);

  const again = (): void => {
    setBegan(Date.now());
    setNow(Date.now());
    setAttempt(1);
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <>
      {/* Present from the first waking render, so "ready" is heard when it changes. */}
      {waking || ready ? (
        <p role="status" className="sr-only">
          {!waking && ready ? `${area} is ready` : ''}
        </p>
      ) : null}
      {waking ? (
        <div className="flex flex-col gap-6">
          {header}
          <div className="flex flex-col gap-4">
            <EmptyState
              icon={<Spinner size="lg" aria-hidden="true" />}
              title={`Waking up ${area}, usually under a minute`}
              description={
                <>
                  The server sleeps when nobody is using it, to keep costs down. This page appears
                  by itself when it is ready.
                  <span className="mt-2 block tabular-nums">
                    Waiting {elapsed(began === null ? 0 : now - began)}
                  </span>
                </>
              }
            />
            {slow ? (
              <Alert
                tone="warning"
                title="This is taking longer than usual"
                action={
                  <Button variant="secondary" onClick={again}>
                    Try again
                  </Button>
                }
              >
                It may still be starting. Try again, and if it stays like this, ask whoever runs
                your Kithena workspace.
              </Alert>
            ) : null}
          </div>
        </div>
      ) : (
        children
      )}
    </>
  );
}

/** The parts of a People frame a header needs (`people-area.tsx`). */
export interface WakingFrame {
  readonly section?: string | null;
  readonly trail?: readonly { readonly href: string; readonly label: string }[];
  readonly tabs?: readonly {
    readonly href: string;
    readonly label: string;
    readonly current: boolean;
  }[];
}

/**
 * A People page's header while the remote that draws it has nothing to draw:
 * its title, its trail and its tabs, from the same frame the remote is given.
 */
export function WakingHeader({
  frame,
  title,
}: {
  readonly frame: WakingFrame;
  readonly title: string;
}): JSX.Element {
  const { section = null, trail = [{ href: '/people', label: 'People' }], tabs = [] } = frame;
  const tab = tabs.find((t) => t.current);
  return (
    <PageHeader
      title={section ?? title}
      breadcrumb={
        section === null ? undefined : (
          <Breadcrumb className="touch:hidden">
            <BreadcrumbList>
              {trail.map((link) => (
                <Fragment key={`${link.href} ${link.label}`}>
                  <BreadcrumbItem>
                    <BreadcrumbLink href={link.href}>{link.label}</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                </Fragment>
              ))}
              <BreadcrumbItem>
                <BreadcrumbPage>
                  {tab === undefined ? section : `${section}: ${tab.label}`}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        )
      }
      tabs={
        tabs.length === 0 ? undefined : (
          <TertiaryNav
            label={`${section ?? title} tabs`}
            orientation="horizontal"
            variant="line"
            current="page"
            touchLayout="pills"
            {...(tab === undefined ? {} : { activeId: tab.href })}
            items={tabs.map((t) => ({ id: t.href, href: t.href, label: t.label }))}
          />
        )
      }
    />
  );
}
