import {
  AssistantComposer,
  AssistantMessage,
  AssistantPanel,
  AssistantSuggestion,
  AssistantSuggestions,
  AssistantText,
  AssistantWidget,
  Button,
  Chip,
  Icon,
} from '@reach/ui-native';
import { Send, Sparkles } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ask, useSigned } from './api';
import { aboutInbox, askInbox, type InboxReply } from '../inbox/api';
import type { Described } from '../timeoff/describe';
import { amount, spanLabel } from '../timeoff/words';
import { t as tr } from '../i18n';

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
  /** An answer about time off ends in the request itself (design v3 H2). */
  readonly request?: { readonly label: string; readonly params: TimeOffAsk };
}

/** What a request from an answer opens with. */
export interface TimeOffAsk {
  readonly leaveTypeKey?: string;
  readonly from: string;
  readonly to: string;
}

/** A question about taking time off, as opposed to one about people. */
export const aboutTimeOff = (question: string): boolean =>
  /\b(time off|days? off|take|vacation|holiday|leave|long weekend|bridge|book)\b/iu.test(question);

const NOTHING = tr(
  'people.ask.im_not_sure_i_can_help',
  'I’m not sure I can help with that one. Try asking about your people: who is in a team, who reports to whom, how many people work where, or what is waiting for your approval.',
);

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
  onRequest,
}: {
  bottomInset: number;
  onOpenPerson: (personId: string, name: string) => void;
  /** On the Inbox tab: its questions, answered from it (M:Z2). */
  onInbox?: boolean;
  onOpenItem?: (id: string) => void;
  /** The company has Time Off: a question about days off is answered with the dates to request. */
  onRequest?: (asked: TimeOffAsk) => void;
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
    if (onRequest !== undefined && !onInbox && aboutTimeOff(question)) {
      void ask<Described>(signed, 'TimeOffDescribe', { sentence: question }, 'timeoff').then(
        (answer) => {
          const best = answer.ok ? answer.data.options[0] : undefined;
          const turn: Turn =
            !answer.ok || best === undefined
              ? {
                  question,
                  text: answer.ok
                    ? tr(
                        'people.ask.i_couldnt_find_dates_that_fit',
                        'I couldn’t find dates that fit. Try saying when, or how many days.',
                      )
                    : answer.message,
                  people: [],
                }
              : {
                  question,
                  text: `${best.fits ? 'Yes.' : tr('people.ask.only_past_your_balance', 'Only past your balance.')} ${spanLabel(best.from, best.to)} ${
                    best.short.length === 0
                      ? 'is free on your team'
                      : `leaves ${String(best.short[0]?.in ?? 0)} of ${String(best.short[0]?.of ?? 0)} in`
                  }${best.leftAfter === null ? '' : `, and you’d have ${amount(best.leftAfter)} days left`}.`,
                  people: [],
                  request: {
                    label: tr('people.ask.request', 'Request {{spanLabel}}', {
                      spanLabel: spanLabel(best.from, best.to),
                    }),
                    params: {
                      ...(answer.data.understood.leaveTypeKey === null
                        ? {}
                        : { leaveTypeKey: answer.data.understood.leaveTypeKey }),
                      from: best.from,
                      to: best.to,
                    },
                  },
                };
          setTurns((held) => held.map((t, i) => (i === held.length - 1 ? turn : t)));
        },
      );
      return;
    }
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
        title={tr('people.ask.ask_kithena', 'Ask Kithena')}
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
            placeholder={
              onInbox
                ? tr('people.ask.ask_about_your_inbox', 'Ask about your inbox…')
                : tr('people.ask.ask_anything', 'Ask anything…')
            }
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
                ? [
                    tr('people.ask.what_do_i_need_to_do', 'What do I need to do this week?'),
                    tr('people.ask.whats_waiting_on_others', 'What’s waiting on others?'),
                  ]
                : [
                    ...(onRequest === undefined
                      ? []
                      : [
                          tr(
                            'people.ask.can_i_take_the_friday_before',
                            'Can I take the Friday before the next holiday?',
                          ),
                        ]),
                    tr('people.ask.who_starts_this_month', 'Who starts this month?'),
                    tr('people.ask.who_reports_to_me', 'Who reports to me?'),
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
                  {t.request === undefined ? null : (
                    <Button
                      variant="primary"
                      fullWidth
                      startIcon={<Icon icon={Send} tone="on-accent" />}
                      onPress={() => {
                        setOpen(false);
                        if (t.request !== undefined) onRequest?.(t.request.params);
                      }}
                    >
                      {t.request.label}
                    </Button>
                  )}
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
