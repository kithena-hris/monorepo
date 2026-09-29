'use client';

import {
  AssistantComposer,
  AssistantLauncher,
  AssistantMessage,
  AssistantPanel,
  AssistantSuggestion,
  AssistantSuggestions,
  Avatar,
  Button,
  icons,
} from '@reach/ui';
import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useRef, useState, type JSX } from 'react';

import { askAssistant } from '../app/assistant/actions';
import type { AssistantReply } from '../lib/assistant';

/**
 * The assistant, in the app: a panel floating in the bottom corner of every
 * page from Reach's launcher, or ⌘J from anywhere. The page stays in view and
 * usable beside it on a desk; under a finger it fills the screen, and the
 * launcher sits clear of the tab bar.
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

const SUGGESTIONS: readonly { readonly text: string; readonly icon: JSX.Element }[] = [
  { text: 'Who reports to me?', icon: <icons.team aria-hidden /> },
  { text: 'How many people are in each department?', icon: <icons.analytics aria-hidden /> },
  { text: 'Who started this year?', icon: <icons.hire aria-hidden /> },
  { text: 'What is waiting for my approval?', icon: <icons.inbox aria-hidden /> },
];

export function Assistant(): JSX.Element {
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
      className="fixed end-6 bottom-6 z-40 flex h-[min(35rem,calc(100dvh-3rem))] w-[25rem] max-w-[calc(100vw-3rem)] touch:inset-0 touch:h-auto touch:w-auto touch:max-w-none"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <AssistantPanel
        title="Ask Kithena"
        subtitle="Answers only with what you can see yourself"
        busy={busy}
        className="touch:rounded-none"
        {...(turns.length === 0
          ? {}
          : {
              onNewChat: () => {
                asked.current += 1;
                setTurns([]);
                setBusy(false);
              },
            })}
        onClose={() => {
          setOpen(false);
        }}
        composer={
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
          />
        }
      >
        <AssistantMessage from="assistant">
          <p>
            Hi! Ask me about the people in your company: who is in a team, who reports to whom, how
            many people work where, or what is waiting for you.
          </p>
        </AssistantMessage>
        {turns.length === 0 ? (
          <AssistantSuggestions aria-label="Try asking">
            {SUGGESTIONS.map((s) => (
              <AssistantSuggestion
                key={s.text}
                icon={s.icon}
                onClick={() => {
                  ask(s.text);
                }}
              >
                {s.text}
              </AssistantSuggestion>
            ))}
          </AssistantSuggestions>
        ) : null}
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
