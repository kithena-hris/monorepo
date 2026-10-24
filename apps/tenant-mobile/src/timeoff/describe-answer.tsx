import {
  Card,
  Field,
  FieldControl,
  FieldLabel,
  Icon,
  Input,
  KeyValues,
  Spinner,
  Text,
} from '@reach/ui-native';
import { CircleCheck, Sparkles, Sun, TriangleAlert, User } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useAct } from '../people/act';
import { read, useSigned } from '../people/api';
import type { Described, Option } from './describe';
import { approversOf, type Preview } from './request-dialog';
import { amount, longSpan } from './words';
import { t } from '../i18n';

/** What a sentence became: the best dates, what they cost, and who decides. */
export interface Answered {
  readonly sentence: string;
  readonly described: Described | null;
  readonly best: Option | null;
  readonly preview: Preview | null;
  readonly failed: string | null;
}

/**
 * "Friday and the Monday after", read into dates (design v3 T2): Time Off's
 * best option for the sentence and its preview, the request's own numbers.
 * The tab draws the card and pins Send in thumb reach.
 */
export function useDescribed(sentence: string | null): {
  readonly answer: Answered | null;
  readonly note: string;
  readonly setNote: (note: string) => void;
  readonly send: () => Promise<string | null>;
  readonly sending: boolean;
} {
  const signed = useSigned();
  const { act, busy } = useAct('timeoff');
  const [answer, setAnswer] = useState<Answered | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (sentence === null) {
      setAnswer(null);
      return undefined;
    }
    const run = { live: true };
    // Asked as a function: after an await the answer may be for a sentence since replaced.
    const alive = (): boolean => run.live;
    setAnswer({ sentence, described: null, best: null, preview: null, failed: null });
    void read<Described>(signed, 'TimeOffDescribe', { sentence }, 'timeoff').then(async (d) => {
      if (!alive()) return;
      if (!d.ok) {
        setAnswer({ sentence, described: null, best: null, preview: null, failed: d.message });
        return;
      }
      const best = d.data.options[0] ?? null;
      const type = d.data.understood.leaveTypeKey;
      const p =
        best === null || type === null
          ? null
          : await read<{ preview: Preview | null }>(
              signed,
              'TimeOffRequestPanel',
              { leaveTypeKey: type, from: best.from, to: best.to, endsHalfDay: false },
              'timeoff',
            );
      if (!alive()) return;
      setAnswer({
        sentence,
        described: d.data,
        best,
        preview: p !== null && p.ok ? p.data.preview : null,
        failed:
          best === null
            ? t(
                'timeoff.describe-answer.no_dates_fit_that_say_when',
                'No dates fit that. Say when, or how many days.',
              )
            : null,
      });
    });
    return () => {
      run.live = false;
    };
  }, [signed, sentence]);

  const send = async (): Promise<string | null> => {
    const type = answer?.described?.understood.leaveTypeKey ?? null;
    const span = answer?.preview?.span;
    if (type === null || span === undefined) return null;
    const sent = await act<{ requestId: string }>(
      'RequestTimeOff',
      {
        input: {
          leaveTypeKey: type,
          span: { from: span.from, to: span.to, startsHalfDay: false, endsHalfDay: false },
          note: note.trim() === '' ? null : note.trim(),
        },
      },
      'Sent',
    );
    return sent?.requestId ?? null;
  };
  return { answer, note, setNote, send, sending: busy === 'RequestTimeOff' };
}

/** The answer as a card: how it read the sentence, the result in plain words, one smarter option. */
export function DescribedCard({
  answer,
  note,
  onNote,
}: {
  answer: Answered;
  note: string;
  onNote: (note: string) => void;
}): React.JSX.Element {
  const { best, preview, described } = answer;
  if (answer.failed !== null)
    return (
      <Card variant="assistant">
        <Text tone="muted">{answer.failed}</Text>
      </Card>
    );
  if (best === null || described === null)
    return <Spinner label={t('timeoff.describe-answer.reading_it', 'Reading it')} />;
  const to = approversOf(preview);
  const short = preview?.belowMinimum ?? best.short;
  const tip = described.options[1];
  return (
    <>
      <Card variant="assistant" className="gap-3">
        <View className="flex-row items-center gap-2.5">
          <View className="size-[30px] items-center justify-center rounded-full bg-accent-solid">
            <Icon icon={Sparkles} size={15} tone="on-accent" />
          </View>
          <Text variant="headline" className="flex-1">
            {t(
              'timeoff.describe-answer.off_days_away',
              {
                one: '{{count}} day off, {{String2}} days away',
                other: '{{count}} days off, {{String2}} days away',
              },
              { count: best.used, String2: String(best.away.days) },
            )}
          </Text>
        </View>
        <Text variant="title2" weight="bold">
          {longSpan(best.from, best.to)}
        </Text>
        <KeyValues
          layout="detail"
          className="-mx-4"
          items={[
            short.length === 0
              ? {
                  id: 'clash',
                  icon: CircleCheck,
                  label: t('timeoff.describe-answer.no_clash', 'No clash'),
                  value:
                    best.fewest === null
                      ? 'The team has enough people in.'
                      : `The team stays at ${String(best.fewest.in)} of ${String(best.fewest.of)}.`,
                }
              : {
                  id: 'clash',
                  icon: TriangleAlert,
                  tone: 'warning' as const,
                  label: t('timeoff.describe-answer.short', 'Short'),
                  value: t(
                    'timeoff.describe-answer.days_below_the_team_s',
                    {
                      one: '{{count}} day below the team’s minimum',
                      other: '{{count}} days below the team’s minimum',
                    },
                    { count: short.length },
                  ),
                },
            ...(preview?.balance == null
              ? []
              : [
                  {
                    id: 'left',
                    icon: Sun,
                    label: t('timeoff.describe-answer.of_now', 'Of {{amount}} now', {
                      amount: amount(preview.balance.before),
                    }),
                    value: `${amount(preview.balance.after)} days left after`,
                  },
                ]),
            ...(to === null
              ? []
              : [
                  {
                    id: 'who',
                    icon: User,
                    label: t('timeoff.describe-answer.who_decides', 'Who decides'),
                    value: `${to} approves`,
                  },
                ]),
          ]}
        />
        {to === null ? null : (
          <Field>
            <FieldLabel>
              {t('timeoff.describe-answer.note_to', 'Note to {{to}}', { to })}
            </FieldLabel>
            <FieldControl>
              <Input
                value={note}
                onChange={onNote}
                placeholder={t('timeoff.describe-answer.optional', 'Optional')}
                size="sm"
              />
            </FieldControl>
          </Field>
        )}
      </Card>
      {tip === undefined ? null : (
        <View className="flex-row items-start gap-1.5 px-1">
          <Icon icon={Sparkles} size={13} tone="accent" />
          <Text variant="footnote" tone="accent" className="flex-1">
            {t('timeoff.describe-answer.or', 'Or: {{text}}', { text: tip.line.text })}
          </Text>
        </View>
      )}
    </>
  );
}
