'use client';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  ChatLog,
  ChatMessage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Timeline,
  TimelineItem,
  icons,
  useToast,
} from '@reach/ui';
import { InboxEvent } from '@kithena/contracts';
import * as z from 'zod';
import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  useTransition,
  type JSX,
  type ReactNode,
} from 'react';

import { moduleName, opensScreen, type Shown } from '../../lib/inbox/model';
import type { TaskScreen } from '../../lib/inbox/task-screen';
import { markRead, moveToDone, snooze } from '../../app/(app)/inbox/actions';
import { Inline, InlineContext, OpenHereContext, type Act } from './pane';
import { dueOf, firstName, iconOf, when } from './format';
import { MuteDialog } from './dialogs';
import { DocumentsBody } from './detail-documents';
import { OnboardingBody } from './detail-onboarding';
import { PeopleBody } from './detail-people';
import { PerformanceBody } from './detail-performance';
import { RecruitingBody } from './detail-recruiting';
import { TimeOffBody } from './detail-timeoff';
import { TaskScreenPane } from './task-screen';
import { t } from '../../lib/t';

// Picks a date or time: its own chunk, fetched when it opens (`dated-dialogs.tsx`).
const SnoozeDialog = lazy(() =>
  import('./dated-dialogs').then((m) => ({ default: m.SnoozeDialog })),
);

/**
 * The detail pane (C1's anatomy, M:B1): always the same parts — what kind it
 * is and where it lives, who asked and when it is due, the ask in the
 * sender's words, the body the module's kind draws, what happened so far, and
 * one primary action. Done here is done in the module too, because acting
 * runs the module's own write.
 */

const LANE_TAG = {
  get task() {
    return t('components.inbox.detail.lane_task', 'Task');
  },
  get update() {
    return t('components.inbox.detail.lane_update', 'Update');
  },
  get request() {
    return t('components.inbox.detail.lane_request', 'Request');
  },
  get done() {
    return t('components.inbox.detail.lane_done', 'Done');
  },
};

/** The pane's top line: kind, module › area, then the menu (Open in … is in it, never a button). */
function Head({ item, menu }: { readonly item: Shown; readonly menu: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge size="sm" tone={item.lane === 'task' ? 'accent' : 'neutral'}>
        {LANE_TAG[item.lane]}
      </Badge>
      <Badge size="sm" variant="outline">
        {item.area === null
          ? moduleName(item.module)
          : t('components.inbox.detail.text', '{{moduleName}} › {{area}}', {
              moduleName: moduleName(item.module),
              area: item.area,
            })}
      </Badge>
      <span className="flex-1" />
      {menu}
    </div>
  );
}

/** Who asked and when, the due date and where it stands. */
function Who({
  item,
  now,
  zone,
}: {
  readonly item: Shown;
  readonly now: string;
  readonly zone: string;
}): JSX.Element {
  const due = item.due === null ? null : dueOf(item.due, item.dueVerb, now, zone);
  const name = item.from?.name ?? null;
  const said =
    item.lane === 'request'
      ? t('components.inbox.detail.you_asked_on', 'You asked on {{at}}', {
          at: when(item.at, zone),
        })
      : name === null
        ? t('components.inbox.detail.kithena', 'Kithena · {{at}}', { at: when(item.at, zone) })
        : t('components.inbox.detail.text_2', '{{name}} · {{at}}', {
            name,
            at: when(item.at, zone),
          });
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
      {name === null || item.lane === 'request' ? null : <Avatar name={name} size="xs" />}
      <span>{said}</span>
      {due === null ? null : (
        <Badge size="sm" tone={due.tone}>
          {due.label}
        </Badge>
      )}
      {item.status === null ? null : (
        <Badge size="sm" tone={item.status.tone} dot>
          {item.status.label}
        </Badge>
      )}
      {item.outcome === null ? null : (
        <Badge size="sm" tone={item.outcome.tone}>
          {item.outcome.label}
        </Badge>
      )}
    </div>
  );
}

const Events = z.object({ events: z.array(InboxEvent) });

/** What happened so far, where the kind keeps it (C1's log). */
function Activity({
  item,
  zone,
}: {
  readonly item: Shown;
  readonly zone: string;
}): JSX.Element | null {
  const parsed = Events.safeParse(item.detail);
  if (!parsed.success || parsed.data.events.length === 0) return null;
  const events = parsed.data.events;
  return (
    <section
      aria-label={t('components.inbox.detail.what_happened', 'What happened')}
      className="flex flex-col gap-2"
    >
      <h3 className="text-sm font-semibold text-fg-muted">
        {t('components.inbox.detail.what_happened', 'What happened')}
      </h3>
      <Timeline>
        {events.map((e, i) => {
          const Icon = iconOf(e.icon);
          return (
            <TimelineItem
              key={`${e.at}-${String(i)}`}
              title={e.text}
              timestamp={when(e.at, zone)}
              icon={<Icon aria-hidden />}
              last={i === events.length - 1}
            />
          );
        })}
      </Timeline>
    </section>
  );
}

/** Times to snooze to, from now (C6): never past the due date, which `snooze` enforces too. */
function snoozeChoices(now: string, due: string | null): { label: string; at: string }[] {
  const at = new Date(now);
  const day = (offset: number, hour: number) => {
    const d = new Date(at);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const monday = (8 - at.getDay()) % 7 || 7;
  const choices = [
    ...(at.getHours() < 15
      ? [{ label: t('components.inbox.detail.this_afternoon', 'This afternoon'), at: day(0, 16) }]
      : []),
    { label: t('components.inbox.detail.tomorrow_morning', 'Tomorrow morning'), at: day(1, 9) },
    { label: t('components.inbox.detail.monday', 'Monday'), at: day(monday, 9) },
  ];
  return choices
    .filter((c) => due === null || c.at.toISOString().slice(0, 10) <= due)
    .map((c) => ({ label: c.label, at: c.at.toISOString() }));
}

export function InboxDetail({
  item,
  now,
  zone,
  onNext,
  screen,
}: {
  readonly item: Shown;
  readonly now: string;
  readonly zone: string;
  /** After a task is finished: the next one (C5). */
  readonly onNext: () => void;
  /** Its module's screen, read with the page, for a task the pane draws one for. */
  readonly screen?: TaskScreen | null;
}): JSX.Element {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [dialog, setDialog] = useState<'snooze' | 'mute' | null>(null);
  // What a link in the body opened here, in the pane, beneath the body.
  const [opened, setOpened] = useState<string | null>(null);
  const openedBox = useRef<HTMLElement>(null);
  useEffect(() => {
    if (opened !== null) openedBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [opened]);
  // An item with no form of its own: its page, in place (`Inline`).
  const inline = (href: string): ReactNode => (
    <TaskScreenPane
      key={href}
      link={href}
      label={item.openIn}
      version={item}
      {...(screen === undefined || href !== item.link ? {} : { initial: screen })}
      onDone={done}
    />
  );
  const done = (): void => {
    toast({
      title: t('components.inbox.detail.done_title', 'Done: {{title}}', { title: item.title }),
      tone: 'success',
    });
    onNext();
  };
  const act: Act = {
    pending,
    error,
    run: (write, success) => {
      setError(null);
      start(async () => {
        const done = await write();
        if (!done.ok) {
          setError(done.message);
          return;
        }
        if (success !== undefined) {
          const undo = success.undo;
          toast({
            title: success.title,
            ...(success.description === undefined ? {} : { description: success.description }),
            tone: 'success',
            duration: undo === undefined ? 5000 : 10_000,
            ...(undo === undefined
              ? {}
              : {
                  action: {
                    label: t('components.inbox.detail.undo', 'Undo'),
                    onClick: () => {
                      void undo();
                    },
                  },
                }),
          });
          if (success.next === true) onNext();
        }
      });
    },
  };
  const sender = firstName(item.from?.name);
  const canAsk = item.kind === 'people.details' && item.lane === 'task' && item.outcome === null;
  const copy = (): void => {
    void navigator.clipboard.writeText(
      `${window.location.origin}/inbox?item=${encodeURIComponent(item.id)}`,
    );
    toast({ title: t('components.inbox.detail.link_copied', 'Link copied'), tone: 'success' });
  };
  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('components.inbox.detail.more', 'More')}
          startIcon={<icons.more aria-hidden />}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {item.lane === 'task' ? (
          <>
            {canAsk ? (
              <DropdownMenuItem
                onSelect={() => {
                  setAsking(true);
                }}
              >
                {sender === ''
                  ? t('components.inbox.detail.ask_them_a_question', 'Ask them a question')
                  : t('components.inbox.detail.ask_a_question', 'Ask {{value}} a question', {
                      value: sender,
                    })}
              </DropdownMenuItem>
            ) : null}
            {item.outcome === null && item.count === null ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t('components.inbox.detail.remind_me_later', 'Remind me later')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {snoozeChoices(now, item.due).map((c) => (
                    <DropdownMenuItem
                      key={c.label}
                      onSelect={() => {
                        act.run(() => snooze(item.id, c.at), {
                          title: t(
                            'components.inbox.detail.snoozed_until',
                            'Snoozed until {{when}}',
                            { when: when(c.at, zone) },
                          ),
                          next: true,
                        });
                      }}
                    >
                      {c.label}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      setDialog('snooze');
                    }}
                  >
                    {t('components.inbox.detail.pick_a_date_and_time', 'Pick a date and time…')}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            {canAsk ? (
              <DropdownMenuItem
                onSelect={() => {
                  setSendingBack(true);
                }}
              >
                {t('components.inbox.detail.i_cant_do_this', 'I can’t do this')}
              </DropdownMenuItem>
            ) : null}
            {item.snoozedUntil === null ? null : (
              <DropdownMenuItem
                onSelect={() => {
                  act.run(() => snooze(item.id, null), {
                    title: t('components.inbox.detail.back_in_to_do', 'Back in To do'),
                  });
                }}
              >
                {t('components.inbox.detail.wake_it_now', 'Wake it now')}
              </DropdownMenuItem>
            )}
          </>
        ) : null}
        {item.lane === 'update' ? (
          <>
            <DropdownMenuItem
              onSelect={() => {
                act.run(() => markRead([item.id], !item.unread));
              }}
            >
              {item.unread
                ? t('components.inbox.detail.mark_read', 'Mark read')
                : t('components.inbox.detail.mark_unread', 'Mark unread')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                act.run(() => moveToDone([item.id]), {
                  title: t('components.inbox.detail.moved_to_done', 'Moved to Done'),
                });
              }}
            >
              {t('components.inbox.detail.move_to_done', 'Move to Done')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setDialog('mute');
              }}
            >
              {t('components.inbox.detail.mute_updates_like_this', 'Mute updates like this…')}
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={item.link}>
            {t('components.inbox.detail.open_in', 'Open in {{openIn}}', { openIn: item.openIn })}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={copy}>
          {t('components.inbox.detail.copy_link', 'Copy link')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const body: ReactNode = opensScreen(item) ? (
    <TaskScreenPane
      link={item.link}
      label={item.openIn}
      version={item}
      {...(screen === undefined ? {} : { initial: screen })}
      onDone={done}
    />
  ) : item.detail === null && item.module !== 'people' ? (
    <GenericBody item={item} />
  ) : item.module === 'people' ? (
    <PeopleBody
      item={item}
      now={now}
      zone={zone}
      act={act}
      asking={asking}
      setAsking={setAsking}
      sendingBack={sendingBack}
      setSendingBack={setSendingBack}
    />
  ) : item.module === 'recruiting' ? (
    <RecruitingBody
      item={item}
      now={now}
      zone={zone}
      act={act}
      asking={asking}
      setAsking={setAsking}
      sendingBack={sendingBack}
      setSendingBack={setSendingBack}
    />
  ) : item.module === 'documents' ? (
    <DocumentsBody
      item={item}
      now={now}
      zone={zone}
      act={act}
      asking={asking}
      setAsking={setAsking}
      sendingBack={sendingBack}
      setSendingBack={setSendingBack}
    />
  ) : item.module === 'onboarding' ? (
    <OnboardingBody
      item={item}
      now={now}
      zone={zone}
      act={act}
      asking={asking}
      setAsking={setAsking}
      sendingBack={sendingBack}
      setSendingBack={setSendingBack}
    />
  ) : item.module === 'performance' ? (
    <PerformanceBody
      item={item}
      now={now}
      zone={zone}
      act={act}
      asking={asking}
      setAsking={setAsking}
      sendingBack={sendingBack}
      setSendingBack={setSendingBack}
    />
  ) : item.module === 'timeoff' ? (
    <TimeOffBody
      item={item}
      now={now}
      zone={zone}
      act={act}
      asking={asking}
      setAsking={setAsking}
      sendingBack={sendingBack}
      setSendingBack={setSendingBack}
    />
  ) : (
    <GenericBody item={item} />
  );
  return (
    <article className="flex flex-col gap-5 p-5 touch:p-4" aria-labelledby="inbox-detail-title">
      <Head item={item} menu={menu} />
      <div className="flex flex-col gap-2">
        <h2 id="inbox-detail-title" className="text-2xl font-bold tracking-tight text-pretty">
          {item.title}
        </h2>
        <Who item={item} now={now} zone={zone} />
      </div>
      {item.message === null || item.message === '' ? null : (
        <ChatLog
          label={
            item.from?.name == null
              ? t('components.inbox.detail.their_message', 'Their message')
              : t('components.inbox.detail.persons_message', '{{name}}’s message', {
                  name: item.from.name,
                })
          }
        >
          <ChatMessage
            from="other"
            author={item.from?.name ?? t('components.inbox.detail.kithena_2', 'Kithena')}
            meta={when(item.at, zone)}
          >
            {item.message}
          </ChatMessage>
        </ChatLog>
      )}
      <OpenHereContext value={setOpened}>
        <InlineContext value={inline}>{body}</InlineContext>
      </OpenHereContext>
      {opened === null ? null : (
        <section
          ref={openedBox}
          aria-label={item.openIn}
          className="flex scroll-mt-4 flex-col gap-3 border-t border-border pt-4"
        >
          <div className="flex items-center gap-2">
            <h3 className="me-auto text-sm font-semibold text-fg-muted">{item.openIn}</h3>
            <Button
              variant="ghost"
              size="sm"
              startIcon={<icons.close aria-hidden />}
              onClick={() => {
                setOpened(null);
              }}
            >
              {t('components.inbox.detail.close', 'Close')}
            </Button>
          </div>
          <TaskScreenPane
            key={opened}
            link={opened}
            label={item.openIn}
            version={item}
            onDone={done}
          />
        </section>
      )}
      <Activity item={item} zone={zone} />
      {error === null ? null : (
        <Alert
          tone="danger"
          title={t('components.inbox.detail.that_did_not_work', 'That did not work')}
        >
          {error}
        </Alert>
      )}
      {dialog === 'snooze' ? (
        <Suspense fallback={null}>
          <SnoozeDialog
            item={item}
            onClose={() => {
              setDialog(null);
            }}
            onPick={(at) => {
              setDialog(null);
              act.run(() => snooze(item.id, at), {
                title: t('components.inbox.detail.snoozed_until', 'Snoozed until {{when}}', {
                  when: when(at, zone),
                }),
                next: true,
              });
            }}
          />
        </Suspense>
      ) : null}
      {dialog === 'mute' ? (
        <MuteDialog
          item={item}
          onClose={() => {
            setDialog(null);
          }}
          act={act}
        />
      ) : null}
    </article>
  );
}

/** Where an item's lane lives in the address. */
export const laneOf = (item: Pick<Shown, 'lane'>): string =>
  ({ task: 'todo', update: 'updates', request: 'requests', done: 'done' })[item.lane];

/** A kind the shell does not know: what it says, and its page in place beneath (A2). */
function GenericBody({ item }: { readonly item: Shown }): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {item.summary === null ? null : <p className="text-base text-fg-muted">{item.summary}</p>}
      <Inline href={item.link} />
    </div>
  );
}
