import {
  Badge,
  Button,
  Card,
  CardTitle,
  Checkbox,
  ListItem,
  Spinner,
  Text,
} from '@reach/ui-native';
import { useEffect, useState } from 'react';

import { ask, formInputs, useSigned } from '../people/api';
import { askDocuments } from './api';

/**
 * Documents that answer HR on the phone (Documents MJ1, MJ2, MJ5; J1, J2,
 * J6), as the web's `answers.tsx`: what the record is waiting for from you —
 * asked for by HR, or missing — looked for in your own documents, for you
 * alone; nothing reaches the record until you tick it and save, and saving
 * it closes HR's ask.
 */

const FILLABLE = new Set(['text', 'number', 'decimal', 'date', 'email', 'phone', 'url']);

interface Waiting {
  readonly key: string;
  readonly label: string;
  readonly asked: boolean;
}

interface Found extends Waiting {
  readonly value: string;
  readonly page: number;
  readonly documentId: string;
}

type Signed = ReturnType<typeof useSigned>;

async function waitingFor(signed: Signed): Promise<readonly Waiting[]> {
  const profile = await ask<{
    sections: readonly {
      fields: readonly {
        key: string;
        label: string;
        dataType: string;
        readOnly: boolean;
        missing: boolean;
      }[];
    }[];
    requests: readonly { key: string }[];
  }>(signed, 'Profile', { personId: null });
  if (!profile.ok) return [];
  const asked = new Set(profile.data.requests.map((r) => r.key));
  return profile.data.sections
    .flatMap((s) => s.fields)
    .filter((f) => !f.readOnly && FILLABLE.has(f.dataType) && (asked.has(f.key) || f.missing))
    .slice(0, 40)
    .map((f) => ({ key: f.key, label: f.label, asked: asked.has(f.key) }));
}

async function lookFor(
  signed: Signed,
  waiting: readonly Waiting[],
  documentIds: readonly string[],
): Promise<Found[]> {
  const found = new Map<string, Found>();
  for (const documentId of documentIds.slice(0, 5)) {
    const left = waiting.filter((w) => !found.has(w.key));
    if (left.length === 0) break;
    const read = await askDocuments<{
      fields: readonly { name: string; value: string; page: number }[];
    }>(signed, 'ReadDocumentFields', { documentId, input: { names: left.map((w) => w.label) } });
    if (!read.ok) continue;
    for (const f of read.data.fields) {
      const w = left.find((x) => x.label === f.name);
      if (w !== undefined && !found.has(w.key)) {
        found.set(w.key, { ...w, value: f.value, page: f.page, documentId });
      }
    }
  }
  return [...found.values()];
}

export function Answers({
  documentIds,
  titles = {},
}: {
  readonly documentIds: readonly string[];
  readonly titles?: Readonly<Record<string, string>>;
}): React.JSX.Element | null {
  const signed = useSigned();
  const [waiting, setWaiting] = useState<readonly Waiting[] | null>(null);
  const [found, setFound] = useState<readonly Found[] | 'looking' | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void waitingFor(signed).then((w) => {
      if (live) setWaiting(w);
    });
    return () => {
      live = false;
    };
  }, [signed]);
  if (waiting === null || waiting.length === 0 || documentIds.length === 0) return null;
  const asked = waiting.filter((w) => w.asked).length;
  const save = async (rows: readonly Found[]): Promise<void> => {
    setBusy(true);
    const changed = Object.fromEntries(
      rows.filter((f) => ticked.has(f.key)).map((f) => [f.key, f.value]),
    );
    const answer = await ask<{ held: readonly string[] | null }>(signed, 'SaveOwnSection', {
      changed: formInputs(changed),
    });
    setBusy(false);
    const held = answer.ok ? (answer.data.held ?? []).length : 0;
    setSaved(
      !answer.ok
        ? answer.message
        : held === 0
          ? 'Saved to your record.'
          : `Saved. ${String(held)} wait for HR to approve.`,
    );
  };
  return (
    <Card variant="assistant">
      <CardTitle>
        {asked > 0
          ? `HR is waiting for ${String(asked)} detail${asked === 1 ? '' : 's'} from you`
          : `Your record is missing ${String(waiting.length)} detail${waiting.length === 1 ? '' : 's'}`}
      </CardTitle>
      {found === null ? (
        <Button
          size="sm"
          onPress={() => {
            setFound('looking');
            void lookFor(signed, waiting, documentIds).then((rows) => {
              setFound(rows);
              setTicked(new Set(rows.map((r) => r.key)));
            });
          }}
        >
          {documentIds.length === 1 ? 'Look in this document' : 'Look in your documents'}
        </Button>
      ) : found === 'looking' ? (
        <Spinner label="Kithena is reading your documents" />
      ) : found.length === 0 ? (
        <Text tone="muted">None of them is in {documentIds.length === 1 ? 'it' : 'them'}.</Text>
      ) : (
        <>
          {found.map((f) => (
            <ListItem
              key={f.key}
              description={`${f.value} · ${titles[f.documentId] ?? 'this document'}, p. ${String(f.page)}`}
              supporting={
                f.asked ? (
                  <Badge size="sm" tone="accent">
                    HR asked
                  </Badge>
                ) : undefined
              }
              trailing={
                <Checkbox
                  accessibilityLabel={`Save ${f.label}`}
                  checked={ticked.has(f.key)}
                  disabled={saved !== null}
                  onCheckedChange={(on) => {
                    const next = new Set(ticked);
                    if (on) next.add(f.key);
                    else next.delete(f.key);
                    setTicked(next);
                  }}
                />
              }
            >
              {f.label}
            </ListItem>
          ))}
          {saved === null ? (
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              disabled={ticked.size === 0}
              onPress={() => void save(found)}
            >
              {`Save ${String(ticked.size)} to your record`}
            </Button>
          ) : (
            <Text>{saved}</Text>
          )}
        </>
      )}
      <Text variant="footnote" tone="muted">
        Read for you alone. Nothing is sent until you save it.
      </Text>
    </Card>
  );
}

/** Which of a person's leave types an event entitles them to, as the web's shell matches it. */
const EVENTS: readonly {
  readonly event: RegExp;
  readonly category?: string;
  readonly name: RegExp;
}[] = [
  {
    event: /birth|born|adopt/iu,
    category: 'parental_leave',
    name: /parent|maternity|paternity|birth|adopt/iu,
  },
  { event: /marri|wedding|civil partnership/iu, name: /marri|wedding|partnership/iu },
  { event: /death|bereave|funeral|passed away/iu, name: /bereave|death|funeral|compassion/iu },
  { event: /move|relocat|new home/iu, name: /mov|relocat/iu },
];

/**
 * A certificate that unlocks leave on the phone (Documents MJ4, J4): the
 * event and its date, each with its page, and the leave of your own it
 * entitles you to, opened in Time Off's request from that day.
 */
export function Certificate({
  documentId,
  onRequest,
}: {
  readonly documentId: string;
  readonly onRequest: (leaveTypeKey: string, from: string | undefined) => void;
}): React.JSX.Element {
  const signed = useSigned();
  const [read, setRead] = useState<
    | { event: string | null; date: string | null; leave: { key: string; name: string } | null }
    | { problem: string }
    | 'reading'
    | null
  >(null);
  const look = async (): Promise<void> => {
    setRead('reading');
    const fields = await askDocuments<{
      fields: readonly { name: string; value: string; page: number }[];
    }>(signed, 'ReadDocumentFields', {
      documentId,
      input: { names: ['Event', 'Date of the event'] },
    });
    if (!fields.ok) {
      setRead({ problem: fields.message });
      return;
    }
    const event = fields.data.fields.find((f) => f.name === 'Event')?.value ?? null;
    const date =
      fields.data.fields.find(
        (f) => f.name === 'Date of the event' && /^\d{4}-\d{2}-\d{2}$/u.test(f.value),
      )?.value ?? null;
    const panel = await ask<{
      leaveTypes: readonly { key: string; name: string; category: string }[];
    }>(signed, 'TimeOffRequestPanel', {}, 'timeoff');
    const rule = event === null ? undefined : EVENTS.find((e) => e.event.test(event));
    const leave =
      rule === undefined || !panel.ok
        ? undefined
        : (panel.data.leaveTypes.find(
            (t) => rule.category !== undefined && t.category === rule.category,
          ) ?? panel.data.leaveTypes.find((t) => rule.name.test(t.name)));
    setRead({
      event,
      date,
      leave: leave === undefined ? null : { key: leave.key, name: leave.name },
    });
  };
  if (read === null) {
    return <Button onPress={() => void look()}>Leave this certificate entitles you to</Button>;
  }
  if (read === 'reading') return <Spinner label="Kithena is reading the certificate" />;
  if ('problem' in read) return <Text tone="danger">{read.problem}</Text>;
  return (
    <Card variant="assistant">
      <CardTitle>What this certificate unlocks</CardTitle>
      <Text>{`${read.event ?? 'It does not say what it records.'}${read.date === null ? '' : ` · ${read.date}`}`}</Text>
      {read.leave === null ? (
        <Text tone="muted">None of your leave types is for it.</Text>
      ) : (
        <Button
          variant="primary"
          onPress={() => {
            if (read.leave !== null) onRequest(read.leave.key, read.date ?? undefined);
          }}
        >
          {`Request ${read.leave.name}${read.date === null ? '' : ` from ${read.date}`}`}
        </Button>
      )}
    </Card>
  );
}
