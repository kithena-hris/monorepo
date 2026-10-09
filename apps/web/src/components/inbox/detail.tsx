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
import { useState, useTransition, type JSX, type ReactNode } from 'react';

import { moduleName, type Shown } from '../../lib/inbox/model';
import { markRead, moveToDone, snooze } from '../../app/(app)/inbox/actions';
import type { Act } from './pane';
import { dueOf, firstName, iconOf, when } from './format';
import { MuteDialog, SnoozeDialog } from './dialogs';
import { PeopleBody } from './detail-people';
import { TimeOffBody } from './detail-timeoff';

/**
 * The detail pane (C1's anatomy, M:B1): always the same parts — what kind it
 * is and where it lives, who asked and when it is due, the ask in the
 * sender's words, the body the module's kind draws, what happened so far, and
 * one primary action. Done here is done in the module too, because acting
 * runs the module's own write.
 */

const LANE_TAG = { task: 'Task', update: 'Update', request: 'Request', done: 'Done' } as const;

/** The pane's top line: kind, module › area, then Open in and the menu. */
function Head({ item, menu }: { readonly item: Shown; readonly menu: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge size="sm" tone={item.lane === 'task' ? 'accent' : 'neutral'}>
        {LANE_TAG[item.lane]}
      </Badge>
      <Badge size="sm" variant="outline">
        {item.area === null ? moduleName(item.module) : `${moduleName(item.module)} › ${item.area}`}
      </Badge>
      <span className="flex-1" />
      <Button asChild variant="ghost" size="sm" startIcon={<icons.externalLink aria-hidden />}>
        <a href={item.link}>{`Open in ${item.openIn}`}</a>
      </Button>
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
      ? `You asked on ${when(item.at, zone)}`
      : name === null
        ? `Kithena · ${when(item.at, zone)}`
        : `${name} · ${when(item.at, zone)}`;
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
    <section aria-label="What happened" className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-fg-muted">What happened</h3>
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
    ...(at.getHours() < 15 ? [{ label: 'This afternoon', at: day(0, 16) }] : []),
    { label: 'Tomorrow morning', at: day(1, 9) },
    { label: 'Monday', at: day(monday, 9) },
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
}: {
  readonly item: Shown;
  readonly now: string;
  readonly zone: string;
  /** After a task is finished: the next one (C5). */
  readonly onNext: () => void;
}): JSX.Element {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [dialog, setDialog] = useState<'snooze' | 'mute' | null>(null);
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
                    label: 'Undo',
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
      `${window.location.origin}/inbox/${laneOf(item)}?item=${encodeURIComponent(item.id)}`,
    );
    toast({ title: 'Link copied', tone: 'success' });
  };
  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label="More"
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
                {`Ask ${sender === '' ? 'them' : sender} a question`}
              </DropdownMenuItem>
            ) : null}
            {item.outcome === null && item.count === null ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Remind me later</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {snoozeChoices(now, item.due).map((c) => (
                    <DropdownMenuItem
                      key={c.label}
                      onSelect={() => {
                        act.run(() => snooze(item.id, c.at), {
                          title: `Snoozed until ${when(c.at, zone)}`,
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
                    Pick a date and time…
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
                I can’t do this
              </DropdownMenuItem>
            ) : null}
            {item.snoozedUntil === null ? null : (
              <DropdownMenuItem
                onSelect={() => {
                  act.run(() => snooze(item.id, null), { title: 'Back in To do' });
                }}
              >
                Wake it now
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
              {item.unread ? 'Mark read' : 'Mark unread'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                act.run(() => moveToDone([item.id]), { title: 'Moved to Done' });
              }}
            >
              Move to Done
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setDialog('mute');
              }}
            >
              Mute updates like this…
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={item.link}>{`Open in ${item.openIn}`}</a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={copy}>Copy link</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const body: ReactNode =
    item.detail === null ? (
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
        <ChatLog label={`${item.from?.name ?? 'Their'} message`}>
          <ChatMessage
            from="other"
            author={item.from?.name ?? 'Kithena'}
            meta={when(item.at, zone)}
          >
            {item.message}
          </ChatMessage>
        </ChatLog>
      )}
      {body}
      <Activity item={item} zone={zone} />
      {error === null ? null : (
        <Alert tone="danger" title="That did not work">
          {error}
        </Alert>
      )}
      {dialog === 'snooze' ? (
        <SnoozeDialog
          item={item}
          onClose={() => {
            setDialog(null);
          }}
          onPick={(at) => {
            setDialog(null);
            act.run(() => snooze(item.id, at), {
              title: `Snoozed until ${when(at, zone)}`,
              next: true,
            });
          }}
        />
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

/** A kind the shell does not know: the item alone, and where it lives (A2). */
function GenericBody({ item }: { readonly item: Shown }): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {item.summary === null ? null : <p className="text-base text-fg-muted">{item.summary}</p>}
      <div>
        <Button asChild variant="primary" startIcon={<icons.externalLink aria-hidden />}>
          <a href={item.link}>{`Open in ${item.openIn}`}</a>
        </Button>
      </div>
    </div>
  );
}
