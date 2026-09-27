'use client';

import {
  Avatar,
  Button,
  ChatComposer,
  ChatLog,
  ChatMessage,
  ChatWindow,
  icons,
  KithenaMark,
} from '@reach/ui';
import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useRef, useState, type JSX } from 'react';

import { askAssistant } from '../app/assistant/actions';
import type { AssistantReply } from '../lib/assistant';

/**
 * The assistant, in the app: a small chat window from a button floating in
 * the bottom-right corner of every page, or ⌘J from anywhere. The page stays
 * in view and usable beside it.
 *
 * It asks every module the company has (`lib/assistant.ts`) and answers as the
 * person asking, with only what they could see themselves. The conversation
 * lives in the panel and nowhere else: closed and opened again it is still
 * there, and a reload starts afresh. Follow-ups work because each question is
 * sent with the ones before it — never with their answers.
 */

interface Turn {
  readonly id: number;
  readonly from: 'self' | 'other';
  readonly text: string;
  readonly people?: AssistantReply['people'];
}

const SUGGESTIONS = [
  'Who reports to me?',
  'How many people are in each department?',
  'Who started this year?',
  'What is waiting for my approval?',
];

const Mark = (): JSX.Element => <KithenaMark className="size-6" />;

export function Assistant(): JSX.Element {
  const [open, onOpenChange] = useState(false);
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const next = useRef(0);

  // ⌘J (Ctrl+J elsewhere) opens it from anywhere, and closes it again.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  const ask = (question: string): void => {
    const earlier = turns.filter((t) => t.from === 'self').map((t) => t.text);
    setTurns((all) => [...all, { id: next.current++, from: 'self', text: question }]);
    setBusy(true);
    void askAssistant(question, earlier)
      .catch(() => ({
        text: 'Sorry, I couldn’t reach Kithena just now. Could you try again in a moment?',
        people: [],
        from: [],
      }))
      .then((reply) => {
        setTurns((all) => [
          ...all,
          { id: next.current++, from: 'other', text: reply.text, people: reply.people },
        ]);
        setBusy(false);
        box.current?.focus();
      });
  };

  return (
    <ChatWindow
      open={open}
      onOpenChange={onOpenChange}
      title="Ask Kithena"
      description="Answers only with what you can see in Kithena yourself."
      launcherLabel="Ask Kithena"
      launcherIcon={<icons.assistant aria-hidden />}
      // Clear of the phone's tab bar; the corner on a desk.
      launcherClassName="bottom-20 md:bottom-6"
      footer={
        <ChatComposer
          inputRef={box}
          label="Ask Kithena a question"
          placeholder="Ask about your people…"
          busy={busy}
          onSend={ask}
        />
      }
    >
      <ChatLog label="Conversation with Kithena" className="min-h-0 flex-1">
        <ChatMessage from="other" author="Kithena" avatar={<Mark />}>
          Hi! Ask me about the people in your company: who is in a team, who reports to whom, how
          many people work where, or what is waiting for you.
        </ChatMessage>
        {turns.length === 0 ? (
          <div className="flex flex-wrap gap-2 pl-9">
            {SUGGESTIONS.map((s) => (
              <Button
                key={s}
                size="sm"
                variant="secondary"
                onClick={() => {
                  ask(s);
                }}
              >
                {s}
              </Button>
            ))}
          </div>
        ) : null}
        {turns.map((t) => (
          <ChatMessage
            key={t.id}
            from={t.from}
            author={t.from === 'self' ? 'You' : 'Kithena'}
            {...(t.from === 'other' ? { avatar: <Mark /> } : {})}
            {...(t.people !== undefined && t.people.length > 0
              ? {
                  footer: (
                    <Mentioned
                      people={t.people}
                      onOpen={() => {
                        onOpenChange(false);
                      }}
                    />
                  ),
                }
              : {})}
          >
            {t.text}
          </ChatMessage>
        ))}
        {busy ? <ChatMessage from="other" author="Kithena" avatar={<Mark />} pending /> : null}
      </ChatLog>
    </ChatWindow>
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
