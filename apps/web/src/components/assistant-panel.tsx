'use client';

import {
  AssistantComposer,
  AssistantMessage,
  AssistantPanel,
  Avatar,
  Button,
  Chip,
  ChipRow,
  icons,
} from '@reach/ui';
import type { Route } from 'next';
import { useEffect, useRef, useState, type JSX } from 'react';

import { nudgeItem } from '../app/(app)/inbox/actions';
import type { AssistantReply } from '../lib/assistant';
import type { InboxReply } from '../lib/inbox/ask';
import { Link } from '../lib/link';

/**
 * Ask Kithena's window (`assistant.tsx`), in a chunk of its own: the shell
 * keeps only the launcher, and this is fetched once the page's own code is in
 * (`kithena:warm`) or a pointer rests on the launcher, so it is here by the
 * time anybody opens it, and no page's first load carries it.
 */

export interface Turn {
  readonly id: number;
  readonly from: 'user' | 'assistant';
  readonly text: string;
  readonly people?: AssistantReply['people'];
  /** An answer about the Inbox: what to open, and a nudge where one is open (Z4). */
  readonly inbox?: InboxReply;
}

/** Ask about your people: the two questions a chip offers above the box, every time. */
const SUGGESTIONS: readonly string[] = ['Who reports to me?', 'What’s waiting for me?'];
/** On the Inbox, the questions about it (Z4). */
const INBOX_SUGGESTIONS: readonly string[] = [
  'What do I need to do this week?',
  'What’s waiting on others?',
];

export interface AssistantWindowProps {
  readonly turns: readonly Turn[];
  readonly draft: string;
  readonly busy: boolean;
  readonly onInbox: boolean;
  readonly setDraft: (draft: string) => void;
  readonly ask: (question: string) => void;
  readonly stop: () => void;
  readonly newChat: () => void;
  readonly minimise: () => void;
  readonly close: () => void;
}

export default function AssistantWindow({
  turns,
  draft,
  busy,
  onInbox,
  setDraft,
  ask,
  stop,
  newChat,
  minimise,
  close,
}: AssistantWindowProps): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  // Straight into the question box on opening, and back to it after each answer.
  useEffect(() => {
    if (!busy) panel.current?.querySelector('textarea')?.focus();
  }, [busy]);

  return (
    <div
      ref={panel}
      // A window from the launcher at a desk; a compact card above the tab bar on a phone.
      className="fixed end-6 bottom-6 z-40 flex h-[min(36.25rem,calc(100dvh-3rem))] w-[25rem] max-w-[calc(100vw-3rem)] touch:inset-x-2.5 touch:end-2.5 touch:bottom-24 touch:h-[min(25rem,calc(100dvh-8rem))] touch:w-auto touch:max-w-none"
      onKeyDown={(event) => {
        // Escape folds it away, as minimise does: the conversation stays.
        if (event.key === 'Escape') minimise();
      }}
    >
      <AssistantPanel
        title="Ask Kithena"
        subtitle="Answers with only what you can see"
        busy={busy}
        {...(turns.length === 0 ? {} : { onNewChat: newChat })}
        onMinimize={minimise}
        onClose={close}
        composer={
          <>
            <ChipRow aria-label="Try asking" className="px-4 pt-2">
              {(onInbox ? INBOX_SUGGESTIONS : SUGGESTIONS).map((text) => (
                <Chip
                  key={text}
                  disabled={busy}
                  onClick={() => {
                    ask(text);
                  }}
                >
                  {text}
                </Chip>
              ))}
            </ChipRow>
            <AssistantComposer
              value={draft}
              onValueChange={setDraft}
              onSubmit={ask}
              streaming={busy}
              onStop={stop}
              placeholder={onInbox ? 'Ask about your inbox…' : 'Ask about your people…'}
              disclaimer={
                <span className="inline-flex items-center gap-1.5 [&_svg]:size-3">
                  <icons.assistant aria-hidden />
                  {onInbox
                    ? 'Opens tasks for you; never finishes one on its own.'
                    : 'Read-only. Sees your question and field names, never values.'}
                </span>
              }
            />
          </>
        }
      >
        <AssistantMessage from="assistant">
          <p>
            Hi! Ask me about the people in your company: who is in a team, who reports to whom, how
            many people work where, or what is waiting for you.
          </p>
        </AssistantMessage>
        {turns.map((t) => (
          <AssistantMessage key={t.id} from={t.from}>
            {t.from === 'user' ? t.text : <p>{t.text}</p>}
            {t.inbox === undefined ? null : <InboxAnswer reply={t.inbox} onOpen={minimise} />}
            {t.people !== undefined && t.people.length > 0 ? (
              <Mentioned people={t.people} onOpen={minimise} />
            ) : null}
          </AssistantMessage>
        ))}
        {busy ? <AssistantMessage from="assistant" streaming /> : null}
      </AssistantPanel>
    </div>
  );
}

/** What an Inbox answer offers: its items to open, and a nudge where one is open (Z4). */
function InboxAnswer({
  reply,
  onOpen,
}: {
  readonly reply: InboxReply;
  readonly onOpen: () => void;
}): JSX.Element | null {
  const [nudged, setNudged] = useState<string | null>(null);
  if (reply.items.length === 0 && reply.nudge === null) return null;
  const nudge = reply.nudge;
  return (
    <ChipRow aria-label="From your Inbox">
      {reply.items.map((i) => (
        <Button key={i.id} asChild size="xs" variant="secondary">
          <Link
            href={`/inbox/${i.lane}?item=${encodeURIComponent(i.id)}` as Route}
            onClick={onOpen}
          >
            {i.hint === null ? i.title : `${i.title} · ${i.hint}`}
          </Link>
        </Button>
      ))}
      {nudge === null ? null : (
        <Chip
          disabled={nudged !== null}
          onClick={() => {
            void nudgeItem(nudge.itemId).then((done) => {
              setNudged(done.ok ? 'Nudged' : done.message);
            });
          }}
        >
          {nudged ?? nudge.label}
        </Chip>
      )}
    </ChipRow>
  );
}

/** The people an answer names, each a way to their profile. */
function Mentioned({
  people,
  onOpen,
}: {
  readonly people: AssistantReply['people'];
  readonly onOpen: () => void;
}): JSX.Element {
  const shown = people.slice(0, 8);
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="People in this answer">
      {shown.map((p) => (
        <li key={p.id}>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/people/${p.id}` as Route} onClick={onOpen}>
              <Avatar size="xs" name={p.name} />
              {p.name}
            </Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}
