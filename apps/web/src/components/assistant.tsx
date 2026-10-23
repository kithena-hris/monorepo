'use client';

import { AssistantLauncher } from '@reach/ui';
import { usePathname } from 'next/navigation';
import { lazy, Suspense, useEffect, useRef, useState, type JSX } from 'react';

import { askAssistant } from '../app/assistant/actions';
import { askInbox } from '../app/(app)/inbox/actions';
import { aboutInbox } from '../lib/inbox/ask';
import type { Turn } from './assistant-panel';
import { t as tr } from '../lib/t';

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

const loadWindow = () => import('./assistant-panel');
const AssistantWindow = lazy(loadWindow);

export function Assistant(): JSX.Element {
  // Open, or folded into the launcher; the conversation outlives either.
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
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

  // The window's code, once the page's own is in: never part of a first load.
  useEffect(() => {
    if (performance.getEntriesByName('kithena:warm').length > 0) {
      void loadWindow();
      return;
    }
    const watch = new PerformanceObserver((list) => {
      if (list.getEntriesByName('kithena:warm').length === 0) return;
      watch.disconnect();
      void loadWindow();
    });
    watch.observe({ type: 'mark', buffered: true });
    return () => {
      watch.disconnect();
    };
  }, []);

  const pathname = usePathname();
  const onInbox = pathname.startsWith('/inbox');
  const ask = (question: string): void => {
    const earlier = turns.filter((t) => t.from === 'user').map((t) => t.text);
    const mine = ++asked.current;
    setTurns((all) => [...all, { id: next.current++, from: 'user', text: question }]);
    setDraft('');
    setBusy(true);
    // About the Inbox: answered from it, here (Z4); anything else goes to the assistant.
    if (onInbox || aboutInbox(question)) {
      void askInbox(question)
        .catch(() => ({
          text: tr(
            'components.assistant.sorry_i_couldnt_read_your_inbox',
            'Sorry, I couldn’t read your Inbox just now.',
          ),
          items: [],
          nudge: null,
        }))
        .then((reply) => {
          if (mine !== asked.current) return;
          setTurns((all) => [
            ...all,
            { id: next.current++, from: 'assistant', text: reply.text, inbox: reply },
          ]);
          setBusy(false);
        });
      return;
    }
    void askAssistant(question, earlier)
      .catch(() => ({
        text: tr(
          'components.assistant.sorry_i_couldnt_reach_kithena_just',
          'Sorry, I couldn’t reach Kithena just now. Could you try again in a moment?',
        ),
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
      });
  };

  if (!open) {
    return (
      <AssistantLauncher
        label={tr('components.assistant.ask_kithena', 'Ask Kithena')}
        shortcut="assistant"
        onOpen={() => {
          setOpen(true);
        }}
        onPointerEnter={() => {
          void loadWindow();
        }}
        // The corner on a desk; clear of the tab bar under a finger.
        className="fixed end-6 bottom-6 z-40 touch:end-4 touch:bottom-24"
      />
    );
  }

  return (
    <Suspense fallback={null}>
      <AssistantWindow
        turns={turns}
        draft={draft}
        busy={busy}
        onInbox={onInbox}
        setDraft={setDraft}
        ask={ask}
        stop={() => {
          asked.current += 1;
          setBusy(false);
        }}
        newChat={() => {
          asked.current += 1;
          setTurns([]);
          setBusy(false);
        }}
        minimise={() => {
          setOpen(false);
        }}
        close={() => {
          // Ends the conversation: a stopped answer's reply is dropped when it comes.
          asked.current += 1;
          setTurns([]);
          setBusy(false);
          setDraft('');
          setOpen(false);
        }}
      />
    </Suspense>
  );
}
