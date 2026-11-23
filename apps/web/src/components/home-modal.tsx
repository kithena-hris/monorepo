'use client';

import {
  Button,
  icons,
  ModalPage,
  ModalPageBody,
  ModalPageContent,
  ModalPageHeader,
  Spinner,
  ToastProvider,
} from '@reach/ui';
import { useRouter } from 'next/navigation';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';

import { inboxItem } from '../app/(app)/inbox/actions';
import { OPEN_EVENT, type OpenDetail } from '../lib/ask-event';
import { t } from '../lib/t';
import { ROOMY, type FrameMessage } from './framed';
import { OpenHereContext } from './inbox/pane';

// The Inbox's own detail and the missing fields, fetched when first opened: never part of Home's load.
const InboxDetail = lazy(() => import('./inbox/detail').then((m) => ({ default: m.InboxDetail })));
const MissingFields = lazy(() =>
  import('./home-missing').then((m) => ({ default: m.MissingFields })),
);

type Task = Awaited<ReturnType<typeof inboxItem>>;

/** What an address opens here: an Inbox item, their own missing fields, or the page itself. */
type Kind =
  | { readonly is: 'task'; readonly id: string }
  | { readonly is: 'missing'; readonly personId: string }
  | { readonly is: 'page' };

function kindOf(href: string): Kind {
  const url = new URL(href, 'https://x');
  const item = url.pathname.startsWith('/inbox/') ? url.searchParams.get('item') : null;
  if (item !== null) return { is: 'task', id: item };
  const person = /^\/people\/([^/]+)$/u.exec(url.pathname)?.[1];
  if (person !== undefined && url.searchParams.get('fill') === 'missing') {
    return { is: 'missing', personId: person };
  }
  return { is: 'page' };
}

/* ------------------------------------------------------- kept frames -- */

/**
 * A page opened here stays loaded after the modal closes, so opening it again
 * is at once, where it was left: no second fetch. It is dropped when it is
 * stale: after `STALE_MS`, or when a write in any other frame may have changed
 * what it shows. Only the last few are kept.
 */
const STALE_MS = 5 * 60_000;
const KEEP = 4;

interface Kept {
  readonly frame: HTMLIFrameElement;
  readonly at: number;
  loaded: boolean;
  /** When its page was last drawn by the server: a new value is a write's answer. */
  drawn: number | null;
}

const kept = new Map<string, Kept>();
/** Set while the modal is open: Escape in a frame, and a write in one. */
let onEscape: (() => void) | null = null;
let wrote = false;

const isFrameMessage = (data: unknown): data is FrameMessage =>
  typeof data === 'object' &&
  data !== null &&
  (data as { kithena?: unknown }).kithena === 'frame' &&
  typeof (data as { value?: unknown }).value === 'number';

function forget(href: string): void {
  kept.get(href)?.frame.remove();
  kept.delete(href);
}

/** Where a kept frame waits, loaded and out of sight. */
function park(): HTMLElement {
  const id = 'home-modal-frames';
  let el = document.getElementById(id);
  if (el === null) {
    el = document.createElement('div');
    el.id = id;
    el.hidden = true;
    document.body.append(el);
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin || !isFrameMessage(event.data)) return;
      const from = [...kept].find(([, k]) => k.frame.contentWindow === event.source);
      if (from === undefined) return;
      const [href, k] = from;
      const { kind, value } = event.data;
      if (kind === 'escape') onEscape?.();
      if (kind !== 'drawn') return;
      if (k.drawn !== null && value !== k.drawn) {
        // A write here: every other kept page, and Home, may show what it changed.
        wrote = true;
        // Deleting from a Map while walking it is safe: a deleted entry is not visited.
        for (const other of kept.keys()) if (other !== href) forget(other);
      }
      k.drawn = value;
    });
  }
  return el;
}

/**
 * Put a frame under another parent without loading it again. `moveBefore`
 * keeps an iframe's page; `append` reloads it.
 * ponytail: a browser without `moveBefore` (Safari today) reloads the page on
 * every open, as before; nothing else changes. Drop the fallback when it ships there.
 */
function move(parent: Element, frame: HTMLIFrameElement): void {
  const p = parent as Element & { moveBefore?: (node: Node, before: Node | null) => void };
  if (typeof p.moveBefore === 'function' && frame.isConnected) p.moveBefore(frame, null);
  else parent.append(frame);
}

function frameFor(href: string, label: string): Kept {
  const had = kept.get(href);
  if (had !== undefined && Date.now() - had.at < STALE_MS) return had;
  forget(href);
  const frame = document.createElement('iframe');
  frame.src = href;
  frame.title = label;
  frame.setAttribute(ROOMY, '');
  frame.className = 'absolute inset-0 size-full border-0 bg-canvas';
  const next: Kept = { frame, at: Date.now(), loaded: false, drawn: null };
  frame.addEventListener('load', () => {
    next.loaded = true;
  });
  park().append(frame);
  kept.set(href, next);
  // The oldest go first: a Map keeps the order they were added in.
  for (const old of [...kept.keys()].slice(0, Math.max(0, kept.size - KEEP))) forget(old);
  return next;
}

/** The page itself, filling the modal's body and scrolling to its edge. */
function KeptFrame({
  href,
  label,
}: {
  readonly href: string;
  readonly label: string;
}): JSX.Element {
  const slot = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  // Before paint, and its cleanup before React removes the slot: the frame is
  // moved out while it is still in the document, so its page survives.
  useLayoutEffect(() => {
    const here = slot.current;
    if (here === null) return;
    const k = frameFor(href, label);
    move(here, k.frame);
    setLoaded(k.loaded);
    const onLoad = (): void => {
      setLoaded(true);
    };
    k.frame.addEventListener('load', onLoad);
    return () => {
      k.frame.removeEventListener('load', onLoad);
      if (kept.get(href) === k) move(park(), k.frame);
    };
  }, [href, label]);
  return (
    <div ref={slot} className="absolute inset-0">
      {loaded ? null : (
        <div className="absolute inset-0 z-10 grid place-items-center bg-canvas">
          <Spinner
            label={t('components.home-modal.opening_label', 'Opening {{label}}', { label })}
          />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- modal -- */

/**
 * A page opened over Home, to do what it is for without leaving: a task from
 * To do is the Inbox's own detail, with its form and its buttons; their
 * missing details are the fields themselves, saved a few at a time; anything
 * else (a person, Review, a time off request, the calendar) is the page
 * itself without its chrome, in a frame that fills the modal and stays loaded
 * for the next time. Closing it leaves Home where it was, read again only
 * when something was written. The header keeps the way to the full page.
 *
 * A screen asks for it with `OPEN_EVENT` on the window, so the People remote
 * that draws Home needs nothing of the shell's but the event's name.
 */
export function HomeModal(): JSX.Element {
  const router = useRouter();
  const [opened, setOpened] = useState<OpenDetail | null>(null);
  // Undefined while its item is read; null when it is gone.
  const [task, setTask] = useState<Task | undefined>(undefined);
  useEffect(() => {
    const onOpen = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as Partial<OpenDetail> | null;
      if (typeof detail?.href !== 'string' || typeof detail.label !== 'string') return;
      const what = kindOf(detail.href);
      setTask(undefined);
      setOpened({ href: detail.href, label: detail.label });
      if (what.is === 'task') {
        void inboxItem(what.id)
          .catch(() => null)
          .then(setTask);
      }
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);
  const close = (): void => {
    setOpened(null);
    // What was done here shows on Home; nothing done, nothing read again.
    if (wrote) router.refresh();
    wrote = false;
  };
  useEffect(() => {
    onEscape = opened === null ? null : close;
    return () => {
      onEscape = null;
    };
  });
  const done = (): void => {
    wrote = true;
  };
  const wait = (
    <div className="grid min-h-48 place-items-center">
      <Spinner label={t('components.home-modal.opening', 'Opening')} />
    </div>
  );
  const kind = opened === null ? null : kindOf(opened.href);
  // A task that is gone, like any other address, is its page.
  const framed = kind !== null && (kind.is === 'page' || (kind.is === 'task' && task === null));
  return (
    // The Inbox's detail says what it did in a toast, as it does on its own page.
    <ToastProvider>
      <ModalPage
        open={opened !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {opened === null || kind === null ? null : (
          <ModalPageContent size="inset" aria-describedby={undefined}>
            <ModalPageHeader
              title={opened.label}
              actions={
                <Button asChild size="sm" variant="ghost" endIcon={<icons.forward aria-hidden />}>
                  <a href={kind.is === 'missing' ? '/people/me' : opened.href}>
                    {t('components.home-modal.open_the_full_page', 'Open the full page')}
                  </a>
                </Button>
              }
            />
            {framed ? (
              // No padding and no scroll of its own: the page scrolls, at the modal's edge.
              <ModalPageBody className="relative overflow-hidden">
                <KeptFrame key={opened.href} href={opened.href} label={opened.label} />
              </ModalPageBody>
            ) : (
              <ModalPageBody className="p-4 touch:p-3">
                <div className="mx-auto max-w-3xl rounded-2xl bg-surface shadow-sm">
                  <Suspense fallback={wait}>
                    {kind.is === 'missing' ? (
                      <div className="px-5 pt-5">
                        {/* A field with no control here opens their record, in this modal. */}
                        <OpenHereContext
                          value={(href) => {
                            setOpened({ href, label: opened.label });
                          }}
                        >
                          <MissingFields personId={kind.personId} onSaved={done} />
                        </OpenHereContext>
                      </div>
                    ) : task === undefined || task === null ? (
                      wait
                    ) : (
                      <InboxDetail
                        key={task.item.id}
                        item={task.item}
                        now={task.now}
                        zone={task.zone}
                        onNext={() => {
                          done();
                          close();
                        }}
                      />
                    )}
                  </Suspense>
                </div>
              </ModalPageBody>
            )}
          </ModalPageContent>
        )}
      </ModalPage>
    </ToastProvider>
  );
}
