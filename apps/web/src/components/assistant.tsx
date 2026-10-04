'use client';

import {
  AssistantComposer,
  AssistantLauncher,
  AssistantMessage,
  AssistantPanel,
  Avatar,
  Button,
  Chip,
  ChipRow,
  icons,
} from '@reach/ui';
import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useRef, useState, type JSX } from 'react';

import { askAssistant } from '../app/assistant/actions';
import type { AssistantReply } from '../lib/assistant';

/**
 * Ask Kithena (design B4, MA A4): a small window grown out of the launcher in
 * the bottom corner of every page, or ⌘J from anywhere. About 400 by 580 on a
 * desk; a compact card above the tab bar on a phone. Never full height, never
 * full screen, and no dimming: the page behind keeps working, so a person
 * chip, a scroll or a profile is still a click away while the chat stays put.
 * Minimise folds it back into the launcher and keeps the conversation; Close
 * ends it.
 *
 * It asks every module the company has (`lib/assistant.ts`) and answers as the
 * person asking, with only what they could see themselves. The conversation
 * lives in the panel and nowhere else: closed and opened again it is still
 * there, and a reload starts afresh. Follow-ups work because each question is
 * sent with the ones before it — never with their answers.
 */

interface Turn {
  readonly id: number;
  readonly from: 'user' | 'assistant';
  readonly text: string;
  readonly people?: AssistantReply['people'];
}

/** Ask about your people: the two questions a chip offers above the box, every time. */
const SUGGESTIONS: readonly string[] = ['Who reports to me?', 'What’s waiting for me?'];

export function Assistant(): JSX.Element {
  // Open, or folded into the launcher; the conversation outlives either.
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const next = useRef(0);
  // A stopped question's answer is dropped when it arrives: a server action
  // cannot be called back, only ignored.
  const asked = useRef(0);

  // ⌘J (Ctrl+J elsewhere) opens it from anywhere, and closes it again.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setOpen((was) => !was);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Straight into the question box on opening.
  useEffect(() => {
    if (open) panel.current?.querySelector('textarea')?.focus();
  }, [open]);

  const ask = (question: string): void => {
    const earlier = turns.filter((t) => t.from === 'user').map((t) => t.text);
    const mine = ++asked.current;
    setTurns((all) => [...all, { id: next.current++, from: 'user', text: question }]);
    setDraft('');
    setBusy(true);
    void askAssistant(question, earlier)
      .catch(() => ({
        text: 'Sorry, I couldn’t reach Kithena just now. Could you try again in a moment?',
        people: [],
        from: [],
      }))
      .then((reply) => {
        if (mine !== asked.current) return;
        setTurns((all) => [
          ...all,
          { id: next.current++, from: 'assistant', text: reply.text, people: reply.people },
        ]);
        setBusy(false);
        panel.current?.querySelector('textarea')?.focus();
      });
  };

  if (!open) {
    return (
      <AssistantLauncher
        label="Ask Kithena"
        shortcut="assistant"
        onOpen={() => {
          setOpen(true);
        }}
        // The corner on a desk; clear of the tab bar under a finger.
        className="fixed end-6 bottom-6 z-40 touch:end-4 touch:bottom-24"
      />
    );
  }

  return (
    <div
      ref={panel}
      // A window from the launcher at a desk; a compact card above the tab bar on a phone.
      className="fixed end-6 bottom-6 z-40 flex h-[min(36.25rem,calc(100dvh-3rem))] w-[25rem] max-w-[calc(100vw-3rem)] touch:inset-x-2.5 touch:end-2.5 touch:bottom-24 touch:h-[min(25rem,calc(100dvh-8rem))] touch:w-auto touch:max-w-none"
      onKeyDown={(event) => {
        // Escape folds it away, as minimise does: the conversation stays.
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <AssistantPanel
        title="Ask Kithena"
        subtitle="Answers with only what you can see"
        busy={busy}
        {...(turns.length === 0
          ? {}
          : {
              onNewChat: () => {
                asked.current += 1;
                setTurns([]);
                setBusy(false);
              },
            })}
        onMinimize={() => {
          setOpen(false);
        }}
        onClose={() => {
          // Ends the conversation: a stopped answer's reply is dropped when it comes.
          asked.current += 1;
          setTurns([]);
          setBusy(false);
          setDraft('');
          setOpen(false);
        }}
        composer={
          <>
            <ChipRow aria-label="Try asking" className="px-4 pt-2">
              {SUGGESTIONS.map((text) => (
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
              onStop={() => {
                asked.current += 1;
                setBusy(false);
              }}
              placeholder="Ask about your people…"
              disclaimer={
                <span className="inline-flex items-center gap-1.5 [&_svg]:size-3">
                  <icons.assistant aria-hidden />
                  Read-only. Sees your question and field names, never values.
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
            {t.people !== undefined && t.people.length > 0 ? (
              <Mentioned
                people={t.people}
                onOpen={() => {
                  setOpen(false);
                }}
              />
            ) : null}
          </AssistantMessage>
        ))}
        {busy ? <AssistantMessage from="assistant" streaming /> : null}
      </AssistantPanel>
    </div>
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
