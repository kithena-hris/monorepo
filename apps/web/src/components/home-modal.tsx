'use client';

import {
  Button,
  icons,
  ModalPage,
  ModalPageBody,
  ModalPageContent,
  ModalPageFooter,
  ModalPageHeader,
  Spinner,
  ToastProvider,
} from '@reach/ui';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';

import { inboxItems } from '../app/(app)/inbox/actions';
import { HELD_EVENT, OPEN_EVENT, type HeldDetail, type OpenDetail } from '../lib/ask-event';
import { t } from '../lib/t';
import { ROOMY, type FrameMessage } from './framed';
import { gapsQuery, STALE_MS, taskQuery } from './home-reads';
import { ActionsSlotContext, OpenHereContext } from './inbox/pane';

// The Inbox's own detail and the missing fields: never part of Home's load,
// fetched ahead of the first open (`useAhead`) so it does not wait for them.
const detailCode = () => import('./inbox/detail');
const missingCode = () => import('./home-missing');
const screensCode = () => import('./inbox/task-screen-cache');
const InboxDetail = lazy(() => detailCode().then((m) => ({ default: m.InboxDetail })));
const MissingFields = lazy(() => missingCode().then((m) => ({ default: m.MissingFields })));

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
 * what it shows. Only the last few are kept. Resting on its link loads it
 * ahead, so the first open is often at once too.
 */
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
  if (had !== undefined && Date.now() - had.at < STALE_MS) {
    had.frame.title = label;
    return had;
  }
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

/* ------------------------------------------------------------- ahead -- */

/** What Home marks as opening here: `data-over` holds the address. */
const OVER = '[data-over]';
/** How long the pointer rests on a link before its page is loaded ahead. */
const REST_MS = 120;

type Task = Awaited<ReturnType<ReturnType<typeof taskQuery>['queryFn']>>;

/** A task whose form is its module's screen: that screen and its code too, as the Inbox's list does. */
async function screenAhead(task: Task): Promise<void> {
  if (task === null || task.item.kind === 'people.setup') return;
  // Fetched here, never with Home.
  const [{ opensScreen }, { prefetchTaskScreen }] = await Promise.all([
    import('../lib/inbox/opens-screen'),
    screensCode(),
  ]);
  if (!opensScreen(task.item)) return;
  void prefetchTaskScreen(task.item.link);
  void import('./inbox/task-screen');
}

/** A hire to set up draws the record's missing fields: read ahead, as the Inbox's list does. */
async function recordAhead(task: Task): Promise<void> {
  if (task?.item.kind !== 'people.setup') return;
  const { prefetchGaps } = await import('./inbox/gaps-cache');
  void prefetchGaps(task.item.id.replace(/^people:setup:/u, ''));
}

/** Read ahead what an address opens: a task or the missing fields, kept by the query client. */
function readAhead(client: QueryClient, href: string): void {
  const what = kindOf(href);
  if (what.is === 'task') {
    void client
      .query(taskQuery(what.id))
      .then((task) => Promise.all([recordAhead(task), screenAhead(task)]))
      .catch(() => undefined);
  }
  if (what.is === 'missing') void client.query(gapsQuery(what.personId)).catch(() => undefined);
}

/**
 * Everything Home links to, read ahead in as few reads as it takes: the
 * browser sends its reads one after another, so every task comes in one, kept
 * under each task's own key; then the missing fields and each hire's record.
 * With `screens`, each task's own screen and its code too, the drawn tasks'
 * first: that is JavaScript, so it waits for the page's own code to be in
 * and Home's first load stays what Home needs.
 */
function readAllAhead(client: QueryClient, screens: boolean): void {
  const marks = [...document.querySelectorAll<HTMLElement>(OVER)];
  const hrefs = marks.map((el) => el.dataset['over'] ?? '');
  // A task Home holds but does not draw (its list shows five) is named by a
  // hidden mark: read with the rest, and its screen after the drawn ones',
  // since a filter or a group brings it up and it is opened straight away.
  const drawn = new Set(marks.filter((el) => !el.hidden).map((el) => el.dataset['over'] ?? ''));
  const tasks = hrefs
    .flatMap((href) => {
      const what = kindOf(href);
      return what.is === 'task' ? [{ id: what.id, drawn: drawn.has(href) }] : [];
    })
    // The browser sends reads one at a time: the rows on screen go first.
    .toSorted((a, b) => Number(b.drawn) - Number(a.drawn));
  const after = (task: Task): void => {
    void recordAhead(task);
    if (screens) void screenAhead(task);
  };
  const held = (id: string): Task | undefined => client.getQueryData(taskQuery(id).queryKey);
  // What an earlier read brought: only what follows it is asked for again,
  // and each of those keeps its own answer.
  for (const { id } of tasks) {
    const task = held(id);
    if (task !== undefined) after(task);
  }
  const unread = tasks.filter(({ id }) => held(id) === undefined);
  if (unread.length > 0) {
    void inboxItems(unread.map((t) => t.id))
      .then((answers) => {
        for (const { id } of unread) {
          // Past what one read answers: asked for when it is opened.
          if (!(id in answers)) continue;
          const task = answers[id] ?? null;
          client.setQueryData(taskQuery(id).queryKey, task);
          after(task);
        }
      })
      .catch(() => undefined);
  }
  for (const href of hrefs) if (kindOf(href).is === 'missing') readAhead(client, href);
  // A page Home marks as worth having ready (asking for time off): loaded in
  // its frame now, with the rest of what a press needs.
  if (screens) {
    for (const el of document.querySelectorAll<HTMLElement>(`${OVER}[data-ahead]`)) {
      const href = el.dataset['over'] ?? '';
      if (kindOf(href).is === 'page') {
        frameFor(href, el.getAttribute('aria-label') ?? el.textContent.trim());
      }
    }
  }
}

/**
 * While Home is on screen: as soon as it has drawn and the browser is idle,
 * every task, missing field and hire's record Home links to is read ahead, so
 * the first press finds them there. The code this modal draws with and each
 * task's own screen follow once the page's own code is in (`kithena:warm`,
 * as the assistant's window does), so they are never part of a first load,
 * or at the first sign of someone there (the pointer moves, a key, a touch)
 * if that comes sooner. A page (a person, Review, a request) is loaded
 * ahead when the pointer rests on its link or the keyboard reaches it, since
 * each is a whole page and only a few are kept.
 */
function useAhead(client: QueryClient): void {
  useEffect(() => {
    // How many marks Home had when they were last read: a widget that arrives
    // later (its rows were still loading) brings more, read then. Told by the
    // document changing, never by a timer.
    let read = -1;
    let someone = false;
    const all = (): void => {
      const marks = document.querySelectorAll(OVER).length;
      if (marks === read) return;
      read = marks;
      readAllAhead(client, someone);
    };
    const arrivals = new MutationObserver(all);
    const begin = (): void => {
      all();
      arrivals.observe(document.body, { childList: true, subtree: true });
    };
    // After Home's own load, not beside it: what Home needs to draw goes first.
    const idle = typeof window.requestIdleCallback === 'function';
    const handle = idle
      ? window.requestIdleCallback(begin, { timeout: 2000 })
      : window.setTimeout(begin, 500);
    const signs = ['pointermove', 'keydown', 'touchstart'] as const;
    const first = (): void => {
      for (const sign of signs) window.removeEventListener(sign, first);
      someone = true;
      void detailCode();
      void missingCode();
      readAllAhead(client, true);
    };
    for (const sign of signs) window.addEventListener(sign, first, { passive: true });
    // The page's own code is in: what a press will need can come now.
    const warm = new PerformanceObserver((list) => {
      if (list.getEntriesByName('kithena:warm').length === 0) return;
      warm.disconnect();
      if (!someone) first();
    });
    warm.observe({ type: 'mark', buffered: true });
    const stop = (): void => {
      warm.disconnect();
      for (const sign of signs) window.removeEventListener(sign, first);
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
      arrivals.disconnect();
    };
    let rest: ReturnType<typeof setTimeout> | undefined;
    const onRest = (event: Event): void => {
      const el = event.target instanceof Element ? event.target.closest<HTMLElement>(OVER) : null;
      clearTimeout(rest);
      if (el === null) return;
      const href = el.dataset['over'] ?? '';
      rest = setTimeout(() => {
        readAhead(client, href);
        if (kindOf(href).is === 'page') {
          frameFor(href, el.getAttribute('aria-label') ?? el.textContent.trim());
        }
      }, REST_MS);
    };
    document.addEventListener('pointerover', onRest);
    document.addEventListener('focusin', onRest);
    return () => {
      stop();
      clearTimeout(rest);
      document.removeEventListener('pointerover', onRest);
      document.removeEventListener('focusin', onRest);
    };
  }, [client]);
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
  const client = useQueryClient();
  useAhead(client);
  // The tasks Home's rows are of, handed over whole as the rows arrive: kept
  // as a read of each would be, so opening one asks nobody.
  useLayoutEffect(() => {
    const onHeld = (event: Event): void => {
      const held = (event as CustomEvent<HeldDetail>).detail;
      for (const item of held.items) {
        const key = taskQuery(item.id).queryKey;
        if (client.getQueryData(key) === undefined) {
          client.setQueryData(key, { item, now: held.now, zone: held.zone });
        }
      }
    };
    window.addEventListener(HELD_EVENT, onHeld);
    return () => {
      window.removeEventListener(HELD_EVENT, onHeld);
    };
  }, [client]);
  const [opened, setOpened] = useState<OpenDetail | null>(null);
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const kind = opened === null ? null : kindOf(opened.href);
  const taskId = kind?.is === 'task' ? kind.id : null;
  // Undefined while its item is read; null when it is gone. Kept, and often read ahead.
  const { data: task } = useQuery({ ...taskQuery(taskId ?? ''), enabled: taskId !== null });
  useEffect(() => {
    const onOpen = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as Partial<OpenDetail> | null;
      if (typeof detail?.href !== 'string' || typeof detail.label !== 'string') return;
      setOpened({ href: detail.href, label: detail.label });
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);
  const close = (): void => {
    setOpened(null);
    // What was done here shows on Home; nothing done, nothing read again.
    if (wrote) {
      void client.invalidateQueries({ queryKey: ['home'] });
      void screensCode().then((m) => {
        m.forgetTaskScreens();
      });
      router.refresh();
    }
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
              // No padding above or below: a bar the content pins (a form's summary)
              // pins to the modal's own edge, with nothing showing past it.
              <ModalPageBody className="px-4 py-0 touch:px-3">
                <div className="mx-auto max-w-3xl">
                  <Suspense fallback={wait}>
                    {kind.is === 'missing' ? (
                      // Its Save is drawn in the modal's footer below, as a task's actions are.
                      <div className="my-4 rounded-2xl bg-surface p-5 shadow-sm">
                        {/* A field with no control here opens their record, in this modal. */}
                        <OpenHereContext
                          value={(href) => {
                            setOpened({ href, label: opened.label });
                          }}
                        >
                          <ActionsSlotContext value={footer}>
                            <MissingFields personId={kind.personId} onSaved={done} />
                          </ActionsSlotContext>
                        </OpenHereContext>
                      </div>
                    ) : task === undefined || task === null ? (
                      wait
                    ) : (
                      // On the page's own colour, as in the Inbox: what its form pins is that colour.
                      // Its actions are drawn in the modal's footer below.
                      <ActionsSlotContext value={footer}>
                        <InboxDetail
                          key={task.item.id}
                          titled={false}
                          item={task.item}
                          now={task.now}
                          zone={task.zone}
                          onNext={() => {
                            done();
                            close();
                          }}
                        />
                      </ActionsSlotContext>
                    )}
                  </Suspense>
                </div>
              </ModalPageBody>
            )}
            {framed ? null : (
              // A task's actions or the fields' Save (`Actions`), fixed under what scrolls; gone while there are none.
              <ModalPageFooter className="has-[[data-slot=actions]:empty]:hidden @2xl:*:w-full">
                <div ref={setFooter} data-slot="actions" />
              </ModalPageFooter>
            )}
          </ModalPageContent>
        )}
      </ModalPage>
    </ToastProvider>
  );
}
