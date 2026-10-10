import {
  AssistantComposer,
  AssistantMessage,
  AssistantPanel,
  AssistantSuggestion,
  AssistantSuggestions,
  AssistantText,
  AssistantWidget,
  Chip,
} from '@reach/ui-native';
import { Sparkles } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ask, useSigned } from './api';
import { aboutInbox, askInbox, type InboxReply } from '../inbox/api';

interface Turn {
  readonly question: string;
  readonly text: string | null;
  readonly people: readonly {
    readonly id: string;
    readonly name: string;
    readonly title: string | null;
  }[];
  /** An answer about the Inbox: items to open, a nudge where one is open (M:Z2). */
  readonly inbox?: InboxReply;
}

const NOTHING =
  'I’m not sure I can help with that one. Try asking about your people: who is in a team, who reports to whom, how many people work where, or what is waiting for your approval.';

/**
 * Ask Kithena (design A4): a compact card above the tab bar, never the whole
 * screen, so the tab bar and the top of the page stay usable. Minimise folds
 * it back into the launcher with the conversation kept; close ends it. People
 * answers as the person asking, with its own rules about what a model sees.
 */
export function AskKithena({
  bottomInset,
  onOpenPerson,
  onInbox = false,
  onOpenItem,
}: {
  bottomInset: number;
  onOpenPerson: (personId: string, name: string) => void;
  /** On the Inbox tab: its questions, answered from it (M:Z2). */
  onInbox?: boolean;
  onOpenItem?: (id: string) => void;
}): React.JSX.Element {
  const signed = useSigned();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const scroller = useRef<ScrollView>(null);
  const waiting = turns.at(-1)?.text === null;

  const send = (text: string): void => {
    const question = text.trim();
    if (question === '' || waiting) return;
    const earlier = turns.map((t) => t.question);
    setDraft('');
    setTurns((held) => [...held, { question, text: null, people: [] }]);
    if (onInbox || aboutInbox(question)) {
      void askInbox(signed, question).then((answer) => {
        setTurns((held) =>
          held.map((t, i) =>
            i === held.length - 1
              ? answer.ok
                ? { question, text: answer.data.text, people: [], inbox: answer.data }
                : { question, text: answer.message, people: [] }
              : t,
          ),
        );
      });
      return;
    }
    void ask<{ text: string; answered: boolean; people: Turn['people'] }>(signed, 'Ask', {
      question,
      earlier,
    }).then((answer) => {
      setTurns((held) =>
        held.map((t, i) =>
          i === held.length - 1
            ? answer.ok
              ? {
                  question,
                  text: answer.data.text === '' ? NOTHING : answer.data.text,
                  people: answer.data.people,
                }
              : { question, text: answer.message, people: [] }
            : t,
        ),
      );
    });
  };

  return (
    <AssistantWidget open={open} onOpenChange={setOpen} bottomInset={bottomInset}>
      <AssistantPanel
        title="Ask Kithena"
        className="flex-1"
        onMinimize={() => {
          setOpen(false);
        }}
        onClose={() => {
          setOpen(false);
          setTurns([]);
          setDraft('');
        }}
        composer={
          <AssistantComposer
            value={draft}
            onValueChange={setDraft}
            onSubmit={send}
            streaming={waiting}
            placeholder={onInbox ? 'Ask about your inbox…' : 'Ask about your people…'}
          />
        }
      >
        <ScrollView
          ref={scroller}
          contentContainerClassName="gap-3 p-3"
          onContentSizeChange={() => {
            scroller.current?.scrollToEnd({ animated: true });
          }}
        >
          {turns.length === 0 ? (
            <AssistantSuggestions>
              {(onInbox
                ? ['What do I need to do this week?', 'What’s waiting on others?']
                : [
                    'Who starts this month?',
                    'Who reports to me?',
                    'How many people work in each team?',
                  ]
              ).map((s) => (
                <AssistantSuggestion
                  key={s}
                  icon={Sparkles}
                  onPress={() => {
                    send(s);
                  }}
                >
                  {s}
                </AssistantSuggestion>
              ))}
            </AssistantSuggestions>
          ) : (
            turns.map((t, i) => (
              <View key={`${String(i)}:${t.question}`} className="gap-3">
                <AssistantMessage from="user">{t.question}</AssistantMessage>
                <AssistantMessage from="assistant" streaming={t.text === null}>
                  <AssistantText>{t.text ?? ''}</AssistantText>
                  {t.inbox === undefined ||
                  (t.inbox.items.length === 0 && t.inbox.nudge === null) ? null : (
                    <View className="flex-row flex-wrap gap-1.5">
                      {t.inbox.items.map((it) => (
                        <Chip
                          key={it.id}
                          onPress={() => {
                            setOpen(false);
                            onOpenItem?.(it.id);
                          }}
                        >
                          {it.hint === null ? it.title : `${it.title} · ${it.hint}`}
                        </Chip>
                      ))}
                      {t.inbox.nudge === null ? null : (
                        <Chip
                          onPress={() => {
                            const id = t.inbox?.nudge?.itemId ?? '';
                            const [module, kind, key] = id.split(':');
                            if (key === undefined) return;
                            void (module === 'people' && kind === 'change'
                              ? ask(signed, 'NudgePendingChange', { id: key })
                              : ask(signed, 'NudgeTimeOffRequest', { requestId: key }, 'timeoff'));
                          }}
                        >
                          {t.inbox.nudge.label}
                        </Chip>
                      )}
                    </View>
                  )}
                  {t.people.length === 0 ? null : (
                    <View className="flex-row flex-wrap gap-1.5">
                      {t.people.map((p) => (
                        <Chip
                          key={p.id}
                          onPress={() => {
                            setOpen(false);
                            onOpenPerson(p.id, p.name);
                          }}
                        >
                          {p.name}
                        </Chip>
                      ))}
                    </View>
                  )}
                </AssistantMessage>
              </View>
            ))
          )}
        </ScrollView>
      </AssistantPanel>
    </AssistantWidget>
  );
}
