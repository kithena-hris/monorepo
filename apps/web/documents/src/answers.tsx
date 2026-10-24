import { Alert, AssistantCard, Badge, Button, Checkbox, List, ListItem, Spinner } from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import type { Read } from './types';
import { t } from './i18n';

/**
 * Documents that answer HR (J1, J2, J6): what the record is waiting for from
 * you — asked for by HR, or missing — looked for in your own documents, for
 * you alone. Each value shows where it was read; nothing reaches the record
 * until you tick it and save, and saving it closes HR's ask.
 */

export interface Waiting {
  readonly key: string;
  readonly label: string;
  readonly asked: boolean;
}

export interface Found extends Waiting {
  readonly value: string;
  readonly page: number;
  readonly documentId: string;
}

export interface AnswersProps {
  readonly onWaitingFor?: (() => Promise<readonly Waiting[]>) | undefined;
  readonly onLookFor?:
    ((documentIds: readonly string[]) => Promise<Read<readonly Found[]>>) | undefined;
  readonly onAnswer?:
    | ((
        changed: Readonly<Record<string, string>>,
      ) => Promise<
        | { readonly ok: true; readonly held?: readonly string[] | number }
        | { readonly ok: false; readonly message: string }
      >)
    | undefined;
}

export function Answers({
  documentIds,
  titles,
  onWaitingFor,
  onLookFor,
  onAnswer,
}: {
  /** Where to look: this document, or your recent ones. */
  readonly documentIds: readonly string[];
  readonly titles?: Readonly<Record<string, string>>;
} & AnswersProps): JSX.Element | null {
  const [waiting, setWaiting] = useState<readonly Waiting[] | null>(null);
  const [found, setFound] = useState<Read<readonly Found[]> | 'looking' | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (onWaitingFor === undefined) return;
    let live = true;
    void onWaitingFor().then((w) => {
      if (live) setWaiting(w);
    });
    return () => {
      live = false;
    };
  }, [onWaitingFor]);

  if (onLookFor === undefined || onAnswer === undefined) return null;
  if (waiting === null || waiting.length === 0 || documentIds.length === 0) return null;
  const asked = waiting.filter((w) => w.asked).length;
  const look = (): void => {
    setFound('looking');
    void onLookFor(documentIds).then((r) => {
      setFound(r);
      if (r.ok) setTicked(new Set(r.data.map((f) => f.key)));
    });
  };
  const rows = found !== null && found !== 'looking' && found.ok ? found.data : [];

  return (
    <AssistantCard
      title={
        asked > 0
          ? t(
              'answers.hr_is_waiting_for_detail_from',
              {
                one: 'HR is waiting for {{count}} detail from you',
                other: 'HR is waiting for {{count}} details from you',
              },
              { count: asked },
            )
          : t(
              'answers.your_record_is_missing_detail',
              {
                one: 'Your record is missing {{count}} detail',
                other: 'Your record is missing {{count}} details',
              },
              { count: waiting.length },
            )
      }
      level={2}
      note={t(
        'answers.read_for_you_alone_nothing_is',
        'Read for you alone. Nothing is sent until you save it.',
      )}
    >
      {found === null ? (
        <Button variant="secondary" size="sm" className="self-start" onClick={look}>
          {documentIds.length === 1
            ? t('answers.look_in_this_document', 'Look in this document')
            : t('answers.look_in_your_documents', 'Look in your documents')}
        </Button>
      ) : found === 'looking' ? (
        <Spinner
          size="sm"
          label={t(
            'answers.kithena_is_reading_your_documents',
            'Kithena is reading your documents',
          )}
        />
      ) : !found.ok ? (
        <Alert tone="danger">{found.message}</Alert>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {documentIds.length === 1
            ? t('answers.this_document_does_not_say_any', 'This document does not say any of them.')
            : t('answers.your_documents_do_not_say_any', 'Your documents do not say any of them.')}
        </p>
      ) : (
        <>
          <List aria-label={t('answers.what_kithena_found', 'What Kithena found')}>
            {rows.map((f) => (
              <ListItem
                key={f.key}
                description={t('answers.p', '{{value}} · {{value2}}, p. {{page}}', {
                  value: f.value,
                  value2: titles?.[f.documentId] ?? t('answers.this_document', 'this document'),
                  page: String(f.page),
                })}
                leading={
                  <Checkbox
                    aria-label={t('answers.save', 'Save {{label}}', { label: f.label })}
                    checked={ticked.has(f.key)}
                    disabled={saved !== null}
                    onCheckedChange={(v) => {
                      const next = new Set(ticked);
                      if (v === true) next.add(f.key);
                      else next.delete(f.key);
                      setTicked(next);
                    }}
                  />
                }
                trailing={
                  f.asked ? (
                    <Badge size="sm" tone="accent">
                      {t('answers.hr_asked', 'HR asked')}
                    </Badge>
                  ) : null
                }
              >
                {f.label}
              </ListItem>
            ))}
          </List>
          {saved === null ? (
            <Button
              variant="primary"
              size="sm"
              className="self-start"
              loading={busy}
              disabled={ticked.size === 0}
              onClick={() => {
                setBusy(true);
                const changed = Object.fromEntries(
                  rows.filter((f) => ticked.has(f.key)).map((f) => [f.key, f.value]),
                );
                void onAnswer(changed).then((r) => {
                  setBusy(false);
                  if (!r.ok) {
                    setSaved(r.message);
                    return;
                  }
                  const held = typeof r.held === 'number' ? r.held : (r.held?.length ?? 0);
                  setSaved(
                    held === 0
                      ? t('answers.saved_to_your_record', 'Saved to your record.')
                      : t(
                          'answers.saved_wait_for_hr_to_approve',
                          'Saved. {{held}} wait for HR to approve.',
                          { held: String(held) },
                        ),
                  );
                });
              }}
            >
              {t('answers.save_to_your_record', 'Save {{size}} to your record', {
                size: String(ticked.size),
              })}
            </Button>
          ) : (
            <p className="text-sm">{saved}</p>
          )}
        </>
      )}
    </AssistantCard>
  );
}
