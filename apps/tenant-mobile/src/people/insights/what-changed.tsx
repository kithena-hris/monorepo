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
      setState(got ?? (answer.ok ? 'People did not answer.' : answer.message));
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

  if (state === null) return <Spinner label="Reading what changed" />;
  if (typeof state === 'string') {
    return (
      <Alert tone="danger" title="Could not load what changed">
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
              {`Nothing Kithena can describe changed ${state.period.inWords}, or none of it is yours to see.`}
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
              {`Show ${String(points.length - FIRST)} more`}
            </Button>
          ) : null}
          <Text variant="footnote" tone="muted">
            {`Groups under ${String(state.minimum)} people are never described. ${
              worded === null
                ? 'Worded by Kithena’s own rules from the figures.'
                : 'Worded by the assistant; every figure is Kithena’s.'
            }`}
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
          Share summary
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
      setDraft(got ?? (a.ok ? 'People did not answer.' : a.message));
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
              text: `Sent to ${who.name}. They get an email with a link that opens only for them, for seven days.`,
            }
          : {
              tone: 'danger',
              text: `Saved for ${who.name}, but the email did not go. Try again in a minute.`,
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
          <DialogTitle>{`Share the ${state.period.name} summary`}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <SegmentedControl
            value={format}
            fullWidth
            size="sm"
            accessibilityLabel="Format"
            onValueChange={(value) => {
              setFormat(value === 'email' ? 'email' : 'pdf');
            }}
          >
            <SegmentedControlItem value="pdf">PDF</SegmentedControlItem>
            <SegmentedControlItem value="email">Message</SegmentedControlItem>
          </SegmentedControl>
          <Field>
            <FieldLabel>Who it’s for</FieldLabel>
            <Select
              value={recipient ?? ME}
              onValueChange={(value) => {
                setRecipient(value === ME ? null : value);
              }}
              disabled={state.recipients.length === 0}
            >
              <SelectTrigger size="sm" accessibilityLabel="Who it’s for">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ME}>You</SelectItem>
                {state.recipients.map((r) => (
                  <SelectItem key={r.accountId} value={r.accountId}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {state.recipients.length === 0 ? (
              <FieldDescription>For you. HR can send it to somebody else.</FieldDescription>
            ) : null}
          </Field>
          {draft === null ? (
            <Spinner label="Writing it for them" />
          ) : typeof draft === 'string' ? (
            <Alert tone="danger" title="Could not prepare it">
              {draft}
            </Alert>
          ) : (
            <Alert
              tone="info"
              title={who === null ? 'Written for you' : `Rewritten for ${firstName(who.name)}`}
            >
              {draft.notes.length > 0
                ? draft.notes.join(' ')
                : who === null
                  ? 'Only what you can see yourself.'
                  : `${who.name} can see all of it, so nothing was changed.`}
            </Alert>
          )}
          {doc === null ? null : (
            <Card variant="fill">
              <Text variant="subhead" numberOfLines={3}>
                {nothing
                  ? 'Nothing in this summary is theirs to see.'
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
                ? 'Share PDF'
                : 'Pick who it’s for'
              : `Send to ${firstName(who.name)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
