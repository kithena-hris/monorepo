import {
  Alert,
  AssistantMark,
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Icon,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Stack,
  Text,
} from '@reach/ui-native';
import { Lock, Share2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { ask, useSigned } from '../api';
import type { Condition } from '../filters';
import { shareBase64 } from '../media';
import { parsed } from '../review/load';
import { t } from '../../i18n';

/** Where a point's records are. */
type Source =
  | { readonly kind: 'joiners'; readonly label: string; readonly from: string; readonly to: string }
  | { readonly kind: 'group'; readonly label: string; readonly value: string }
  | { readonly kind: string; readonly label: string };

interface Part {
  readonly text: string;
  readonly strong: boolean;
}

interface Point {
  readonly key: string;
  readonly figure: string;
  readonly text: string;
  readonly parts: readonly Part[];
  readonly sources: readonly Source[];
  readonly audience: string | null;
}

interface WhatChangedState {
  readonly asOf: string;
  readonly period: { readonly name: string; readonly inWords: string };
  readonly title: string;
  readonly writtenAt: string;
  readonly minimum: number;
  readonly points: readonly Point[];
  readonly phrasable: boolean;
  readonly recipients: readonly { readonly accountId: string; readonly name: string }[];
  readonly canSend: boolean;
}

interface SummaryDraft {
  readonly notes: readonly string[];
  readonly document: {
    readonly points: readonly { readonly key: string; readonly text: string }[];
  };
}

function open(source: Source, go: (to: SourceTarget) => void): void {
  const directory = (conditions: Condition[]): void => {
    go({ screen: 'Directory', conditions });
  };
  if (source.kind === 'joiners' && 'from' in source) {
    directory([{ key: 'hire_date', op: 'between', values: [source.from, source.to] }]);
  } else if (source.kind === 'group' && 'value' in source) {
    directory([{ key: 'org_unit', op: 'is', values: [source.value] }]);
  } else if (source.kind === 'headcount') go({ screen: 'Insights', tab: 'headcount' });
  else if (source.kind === 'turnover' || source.kind === 'span') {
    go({ screen: 'Insights', tab: 'turnover' });
  } else if (source.kind === 'pay') go({ screen: 'Insights', tab: 'pay' });
  else if (source.kind === 'org-chart') go({ screen: 'OrgChart' });
  else go({ screen: 'Review' });
}

export type SourceTarget =
  | { readonly screen: 'Directory'; readonly conditions: Condition[] }
  | { readonly screen: 'Insights'; readonly tab: string }
  | { readonly screen: 'OrgChart' }
  | { readonly screen: 'Review' };

const FIRST = 3;
const ME = '__me';
const firstName = (name: string): string => name.split(' ')[0] ?? name;

/**
 * What changed (design G1, G3): the month's points, the first three and Show
 * more, each with its figure, its sentence and the records it came from, then
 * a full-width Share. The period control, the follow-up and the charts stay
 * at a desk.
 */
export function WhatChanged({
  segment,
  go,
}: {
  segment: string | null;
  go: (to: SourceTarget) => void;
}): React.JSX.Element {
  const signed = useSigned();
  const [state, setState] = useState<WhatChangedState | string | null>(null);
  const [worded, setWorded] = useState<readonly Point[] | null>(null);
  const [more, setMore] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let live = true;
    setState(null);
    setWorded(null);
    void ask<string>(signed, 'WhatChanged', { segment }).then((answer) => {
      if (!live) return;
      const got = answer.ok ? (parsed(answer.data) as WhatChangedState | null) : null;
      setState(
        got ??
          (answer.ok
            ? t('people.insights.what-changed.people_did_not_answer', 'People did not answer.')
            : answer.message),
      );
      // The points in the assistant's words, where there is one; People's own otherwise.
      if (got?.phrasable === true) {
        void ask<string>(signed, 'WhatChangedWorded', { segment }).then((w) => {
          const a = w.ok
            ? (parsed(w.data) as { points?: Point[]; byModel?: boolean } | null)
            : null;
          if (live && a?.points !== undefined && a.byModel === true) setWorded(a.points);
        });
      }
    });
    return () => {
      live = false;
    };
  }, [signed, segment]);

  if (state === null)
    return (
      <Spinner
        label={t('people.insights.what-changed.reading_what_changed', 'Reading what changed')}
      />
    );
  if (typeof state === 'string') {
    return (
      <Alert
        tone="danger"
        title={t(
          'people.insights.what-changed.could_not_load_what_changed',
          'Could not load what changed',
        )}
      >
        {state}
      </Alert>
    );
  }
  const points = worded ?? state.points;
  const shown = more ? points : points.slice(0, FIRST);
  return (
    <Stack gap={3}>
      <Card>
        <Stack gap={1}>
          <View className="flex-row items-center gap-2">
            <AssistantMark size={20} />
            <Text variant="headline" className="flex-1">
              {state.title}
            </Text>
            <Badge size="sm">{state.writtenAt}</Badge>
          </View>
          {points.length === 0 ? (
            <Text tone="muted">
              {t(
                'people.insights.what-changed.nothing_kithena_can_describe_changed_or',
                'Nothing Kithena can describe changed {{inWords}}, or none of it is yours to see.',
                { inWords: state.period.inWords },
              )}
            </Text>
          ) : (
            shown.map((p, i) => (
              <View
                key={p.key}
                className={`flex-row gap-3 py-3${i < shown.length - 1 ? ' border-b border-border' : ''}`}
              >
                <View className="w-18">
                  <Badge tone="neutral">{p.figure}</Badge>
                </View>
                <Stack gap={2} className="flex-1">
                  <Text>
                    {p.parts.map((part, j) =>
                      part.strong ? (
                        <Text key={j} weight="semibold">
                          {part.text}
                        </Text>
                      ) : (
                        part.text
                      ),
                    )}
                  </Text>
                  <View className="flex-row flex-wrap gap-1.5">
                    {p.sources.map((s) => (
                      <Button
                        key={`${s.kind}:${s.label}`}
                        size="sm"
                        onPress={() => {
                          open(s, go);
                        }}
                      >
                        {s.label}
                      </Button>
                    ))}
                    {p.audience === null ? null : (
                      <Badge size="sm" tone="neutral" icon={Lock}>
                        {p.audience}
                      </Badge>
                    )}
                  </View>
                </Stack>
              </View>
            ))
          )}
          {points.length > FIRST && !more ? (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                setMore(true);
              }}
            >
              {t('people.insights.what-changed.show_more', 'Show {{String}} more', {
                String: String(points.length - FIRST),
              })}
            </Button>
          ) : null}
          <Text variant="footnote" tone="muted">
            {t(
              'people.insights.what-changed.groups_under_people_are_never_described',
              'Groups under {{String}} people are never described. {{value}}',
              {
                String: String(state.minimum),
                value:
                  worded === null
                    ? 'Worded by Kithena’s own rules from the figures.'
                    : 'Worded by the assistant; every figure is Kithena’s.',
              },
            )}
          </Text>
        </Stack>
      </Card>
      {state.points.length === 0 ? null : (
        <Button
          fullWidth
          variant="primary"
          startIcon={<Icon icon={Share2} />}
          onPress={() => {
            setSharing(true);
          }}
        >
          {t('people.insights.what-changed.share_summary', 'Share summary')}
        </Button>
      )}
      {sharing ? (
        <ShareDialog
          state={state}
          segment={segment}
          onClose={() => {
            setSharing(false);
          }}
        />
      ) : null}
    </Stack>
  );
}

/**
 * Sharing the summary (G3): the format, who it is for, what was rewritten for
 * them, and a three-line excerpt of what they will read. A PDF for yourself
 * goes to the share sheet; for somebody else it is sent, with a link that
 * opens only for them.
 */
function ShareDialog({
  state,
  segment,
  onClose,
}: {
  state: WhatChangedState;
  segment: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const signed = useSigned();
  const [format, setFormat] = useState<'pdf' | 'email'>('pdf');
  const [recipient, setRecipient] = useState<string | null>(null);
  const [draft, setDraft] = useState<SummaryDraft | string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const base = {
    ...(segment === null ? {} : { segment }),
    tone: 'short',
    charts: true,
    madeLine: true,
    ...(recipient === null ? {} : { recipient }),
    edits: [],
  };

  useEffect(() => {
    let live = true;
    setDraft(null);
    setDone(null);
    void ask<string>(signed, 'SummaryDraft', { input: JSON.stringify(base) }).then((a) => {
      if (!live) return;
      const got = a.ok ? (parsed(a.data) as SummaryDraft | null) : null;
      setDraft(
        got ??
          (a.ok
            ? t('people.insights.what-changed.people_did_not_answer', 'People did not answer.')
            : a.message),
      );
    });
    return () => {
      live = false;
    };
    // The draft depends on who it is for and nothing else on a phone.
  }, [signed, recipient]);

  const who = state.recipients.find((r) => r.accountId === recipient) ?? null;
  const doc = draft !== null && typeof draft !== 'string' ? draft.document : null;
  const nothing = doc !== null && doc.points.length === 0;

  const send = async (): Promise<void> => {
    setBusy(true);
    setDone(null);
    if (who === null) {
      // For yourself: the PDF, to keep or pass on from the share sheet.
      const pdf = await ask<string>(signed, 'SummaryPdf', { input: JSON.stringify(base) });
      setBusy(false);
      if (!pdf.ok) {
        setDone({ tone: 'danger', text: pdf.message });
        return;
      }
      await shareBase64(
        pdf.data,
        `what-changed-${new Date().toISOString().slice(0, 10)}.pdf`,
        'application/pdf',
      );
      return;
    }
    const sent = await ask<string>(signed, 'ShareSummary', {
      input: JSON.stringify({ ...base, recipient: who.accountId, format }),
    });
    setBusy(false);
    const emailed =
      sent.ok && (parsed(sent.data) as { emailed?: boolean } | null)?.emailed === true;
    setDone(
      !sent.ok
        ? { tone: 'danger', text: sent.message }
        : emailed
          ? {
              tone: 'success',
              text: t(
                'people.insights.what-changed.sent_to_they_get_an_email',
                'Sent to {{name}}. They get an email with a link that opens only for them, for seven days.',
                { name: who.name },
              ),
            }
          : {
              tone: 'danger',
              text: t(
                'people.insights.what-changed.saved_for_but_the_email_did',
                'Saved for {{name}}, but the email did not go. Try again in a minute.',
                { name: who.name },
              ),
            },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('people.insights.what-changed.share_the_summary', 'Share the {{name}} summary', {
              name: state.period.name,
            })}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <SegmentedControl
            value={format}
            fullWidth
            size="sm"
            accessibilityLabel={t('people.insights.what-changed.format', 'Format')}
            onValueChange={(value) => {
              setFormat(value === 'email' ? 'email' : 'pdf');
            }}
          >
            <SegmentedControlItem value="pdf">
              {t('people.insights.what-changed.pdf', 'PDF')}
            </SegmentedControlItem>
            <SegmentedControlItem value="email">
              {t('people.insights.what-changed.message', 'Message')}
            </SegmentedControlItem>
          </SegmentedControl>
          <Field>
            <FieldLabel>{t('people.insights.what-changed.who_its_for', 'Who it’s for')}</FieldLabel>
            <Select
              value={recipient ?? ME}
              onValueChange={(value) => {
                setRecipient(value === ME ? null : value);
              }}
              disabled={state.recipients.length === 0}
            >
              <SelectTrigger
                size="sm"
                accessibilityLabel={t('people.insights.what-changed.who_its_for', 'Who it’s for')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ME}>{t('people.insights.what-changed.you', 'You')}</SelectItem>
                {state.recipients.map((r) => (
                  <SelectItem key={r.accountId} value={r.accountId}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {state.recipients.length === 0 ? (
              <FieldDescription>
                {t(
                  'people.insights.what-changed.for_you_hr_can_send_it',
                  'For you. HR can send it to somebody else.',
                )}
              </FieldDescription>
            ) : null}
          </Field>
          {draft === null ? (
            <Spinner
              label={t('people.insights.what-changed.writing_it_for_them', 'Writing it for them')}
            />
          ) : typeof draft === 'string' ? (
            <Alert
              tone="danger"
              title={t('people.insights.what-changed.could_not_prepare_it', 'Could not prepare it')}
            >
              {draft}
            </Alert>
          ) : (
            <Alert
              tone="info"
              title={
                who === null
                  ? t('people.insights.what-changed.written_for_you', 'Written for you')
                  : t('people.insights.what-changed.rewritten_for', 'Rewritten for {{firstName}}', {
                      firstName: firstName(who.name),
                    })
              }
            >
              {draft.notes.length > 0
                ? draft.notes.join(' ')
                : who === null
                  ? t(
                      'people.insights.what-changed.only_what_you_can_see_yourself',
                      'Only what you can see yourself.',
                    )
                  : t(
                      'people.insights.what-changed.can_see_all_of_it_so',
                      '{{name}} can see all of it, so nothing was changed.',
                      { name: who.name },
                    )}
            </Alert>
          )}
          {doc === null ? null : (
            <Card variant="fill">
              <Text variant="subhead" numberOfLines={3}>
                {nothing
                  ? t(
                      'people.insights.what-changed.nothing_in_this_summary_is_theirs',
                      'Nothing in this summary is theirs to see.',
                    )
                  : doc.points.map((p) => p.text).join(' ')}
              </Text>
            </Card>
          )}
          {done === null ? null : <Alert tone={done.tone}>{done.text}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button
            className="flex-1"
            fullWidth
            variant="primary"
            disabled={
              doc === null ||
              nothing ||
              done?.tone === 'success' ||
              (who === null ? format !== 'pdf' : !state.canSend)
            }
            loading={busy}
            onPress={() => void send()}
          >
            {who === null
              ? format === 'pdf'
                ? t('people.insights.what-changed.share_pdf', 'Share PDF')
                : t('people.insights.what-changed.pick_who_its_for', 'Pick who it’s for')
              : t('people.insights.what-changed.send_to', 'Send to {{firstName}}', {
                  firstName: firstName(who.name),
                })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
