'use client';

import {
  Button,
  icons,
  ModalPage,
  ModalPageBody,
  ModalPageContent,
  ModalPageHeader,
  Spinner,
} from '@reach/ui';
import { useRouter } from 'next/navigation';
import { lazy, Suspense, useEffect, useState, type JSX } from 'react';

import { inboxItem } from '../app/(app)/inbox/actions';
import { OPEN_EVENT, type OpenDetail } from '../lib/ask-event';
import { t } from '../lib/t';
import { FramePane } from './inbox/frame-pane';

// The Inbox's own detail, fetched on the first task opened: never part of Home's load.
const InboxDetail = lazy(() => import('./inbox/detail').then((m) => ({ default: m.InboxDetail })));

type Task = Awaited<ReturnType<typeof inboxItem>>;

/** The Inbox item an address opens, or null for any other page. */
const itemOf = (href: string): string | null => {
  const url = new URL(href, 'https://x');
  return url.pathname.startsWith('/inbox/') ? url.searchParams.get('item') : null;
};

/**
 * A page opened over Home, to do what it is for without leaving: a task from
 * To do is the Inbox's own detail, with its form and its buttons; anything
 * else (a person, Review, a time off request, the calendar) is the page
 * itself without its chrome, in a frame (`inbox/frame-pane.tsx`), as the
 * Inbox's pane draws it. Closing it leaves Home where it was, read again so
 * what was done shows. The header keeps the way to the full page.
 *
 * A screen asks for it with `OPEN_EVENT` on the window, so the People remote
 * that draws Home needs nothing of the shell's but the event's name.
 */
export function HomeModal(): JSX.Element {
  const router = useRouter();
  const [opened, setOpened] = useState<OpenDetail | null>(null);
  // Undefined while its item is read; null when it is not an Inbox item, or is gone.
  const [task, setTask] = useState<Task | undefined>(undefined);
  useEffect(() => {
    const onOpen = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as Partial<OpenDetail> | null;
      if (typeof detail?.href !== 'string' || typeof detail.label !== 'string') return;
      const id = itemOf(detail.href);
      setTask(id === null ? null : undefined);
      setOpened({ href: detail.href, label: detail.label });
      if (id !== null) {
        void inboxItem(id)
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
    // What was done here shows on Home.
    router.refresh();
  };
  const wait = (
    <div className="grid min-h-48 place-items-center">
      <Spinner label={t('components.home-modal.opening', 'Opening')} />
    </div>
  );
  return (
    <ModalPage
      open={opened !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {opened === null ? null : (
        <ModalPageContent size="inset" aria-describedby={undefined}>
          <ModalPageHeader
            title={opened.label}
            actions={
              <Button asChild size="sm" variant="ghost" endIcon={<icons.forward aria-hidden />}>
                <a href={opened.href}>
                  {t('components.home-modal.open_the_full_page', 'Open the full page')}
                </a>
              </Button>
            }
          />
          <ModalPageBody className="p-4 touch:p-3">
            {task === undefined ? (
              wait
            ) : task === null ? (
              <FramePane key={opened.href} link={opened.href} label={opened.label} />
            ) : (
              <div className="mx-auto max-w-3xl rounded-2xl bg-surface shadow-sm">
                <Suspense fallback={wait}>
                  <InboxDetail
                    key={task.item.id}
                    item={task.item}
                    now={task.now}
                    zone={task.zone}
                    onNext={close}
                  />
                </Suspense>
              </div>
            )}
          </ModalPageBody>
        </ModalPageContent>
      )}
    </ModalPage>
  );
}
