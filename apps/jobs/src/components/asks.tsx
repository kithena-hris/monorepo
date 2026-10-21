'use client';

import type { CandidatePage } from '@kithena/contracts';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  List,
  ListItem,
  RadioCard,
  RadioGroup,
  Textarea,
  icons,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { publicApi } from '../lib/browser-api';

/**
 * The candidate's notification centre: everything a company is waiting on
 * from them, or has told them, across every application. Each item opens
 * what it needs: times to choose from, a question to answer, a booked
 * interview to question, an offer to read. Built from the candidate page
 * each company answers, so it is never a second source of truth.
 */

type Application = CandidatePage['applications'][number];
type Request = Application['requests'][number];
type Interview = Application['interviews'][number];

export interface Notice {
  readonly id: string;
  /** Where to act: the company's slug and the token for its page. */
  readonly company: { readonly slug: string; readonly name: string; readonly token: string };
  readonly application: Application;
  readonly kind: 'slots' | 'info' | 'interview' | 'offer' | 'answered' | 'closed';
  readonly title: string;
  readonly detail: string | null;
  readonly at: string;
  /** Something the candidate still has to do. */
  readonly open: boolean;
  readonly request?: Request;
  readonly interview?: Interview;
}

export const whenLong = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Every notice across the pages, what needs the candidate first, newest first within that. */
export function noticesOf(
  pages: readonly {
    readonly company: { readonly slug: string; readonly name: string; readonly token: string };
    readonly page: CandidatePage | null;
  }[],
): readonly Notice[] {
  const out: Notice[] = [];
  for (const { company, page } of pages) {
    for (const application of page?.applications ?? []) {
      const job = `${application.job.title} at ${company.name}`;
      for (const r of application.requests) {
        if (r.kind === 'change') {
          out.push({
            id: r.id,
            company,
            application,
            kind: r.state === 'open' ? 'answered' : 'closed',
            title:
              r.state === 'open'
                ? `You asked to move the ${r.label.toLowerCase()}`
                : `The ${r.label.toLowerCase()} change was handled`,
            detail: job,
            at: r.createdAt,
            open: false,
            request: r,
          });
          continue;
        }
        if (r.state === 'open')
          out.push({
            id: r.id,
            company,
            application,
            kind: r.kind,
            title:
              r.kind === 'slots'
                ? `Choose a time for your ${r.label.toLowerCase()}`
                : `${company.name} asks: ${r.label}`,
            detail: job,
            at: r.createdAt,
            open: true,
            request: r,
          });
        else
          out.push({
            id: r.id,
            company,
            application,
            kind: 'answered',
            title:
              r.kind === 'slots'
                ? r.answer?.time != null
                  ? `Booked: ${r.label}, ${whenLong(r.answer.time)}`
                  : `You asked ${company.name} for other times`
                : `Answered: ${r.label}`,
            detail: job,
            at: r.createdAt,
            open: false,
            request: r,
          });
      }
      for (const i of application.interviews)
        out.push({
          id: i.id,
          company,
          application,
          kind: 'interview',
          title: `${i.title}: ${whenLong(i.startsAt)}`,
          detail: `${job}${i.where === null ? '' : ` · ${i.where}`}`,
          at: i.startsAt,
          open: false,
          interview: i,
        });
      if (application.offer?.state === 'sent')
        out.push({
          id: application.offer.offerId,
          company,
          application,
          kind: 'offer',
          title: 'An offer to read',
          detail: job,
          at: application.offer.expiresOn,
          open: true,
        });
    }
  }
  return out.toSorted((a, b) => Number(b.open) - Number(a.open) || b.at.localeCompare(a.at));
}

const ICON: Readonly<Record<Notice['kind'], keyof typeof icons>> = {
  slots: 'calendar',
  info: 'help',
  interview: 'meeting',
  offer: 'agreement',
  answered: 'success',
  closed: 'success',
};

/** The dialog behind a notice: pick a time, answer, or ask for a change. */
export function NoticeDialog({
  notice,
  onClose,
  onDone,
}: {
  readonly notice: Notice | null;
  readonly onClose: () => void;
  readonly onDone: (said: string) => void;
}): JSX.Element {
  const [time, setTime] = useState<string>('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const r = notice?.request;
  const i = notice?.interview;
  const changeAsked =
    i !== undefined &&
    notice !== null &&
    notice.application.requests.some(
      (x) => x.kind === 'change' && x.interviewId === i.id && x.state === 'open',
    );
  const send = (path: string, body: unknown, said: string): void => {
    if (notice === null) return;
    start(async () => {
      setError(null);
      const answer = await publicApi(notice.company.slug, path, {
        method: 'POST',
        body,
        token: notice.company.token,
      });
      if (!answer.ok) setError(answer.message);
      else {
        setTime('');
        setText('');
        onDone(said);
      }
    });
  };
  return (
    <Dialog
      open={notice !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{notice?.title ?? ''}</DialogTitle>
          <DialogDescription>{notice?.detail ?? ''}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {error === null ? null : (
            <p role="alert" className="text-sm text-danger-fg">
              {error}
            </p>
          )}
          {r?.kind === 'slots' && r.state === 'open' ? (
            <>
              {r.detail === null ? null : <p className="text-sm">{r.detail}</p>}
              <RadioGroup aria-label="Times offered" value={time} onValueChange={setTime}>
                {r.times.map((t) => (
                  <RadioCard key={t} value={t} description={r.where ?? undefined}>
                    {whenLong(t)}
                  </RadioCard>
                ))}
                <RadioCard
                  value="none"
                  description="Say when suits you and they will offer others."
                >
                  None of these work
                </RadioCard>
              </RadioGroup>
              {time === 'none' ? (
                <Field required>
                  <FieldLabel>When would suit you?</FieldLabel>
                  <FieldControl>
                    <Textarea
                      autoResize
                      value={text}
                      onChange={(e) => {
                        setText(e.target.value);
                      }}
                    />
                  </FieldControl>
                </Field>
              ) : null}
              <p className="text-xs text-fg-muted">
                {`Times are shown in your time zone, ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`}
              </p>
            </>
          ) : null}
          {r?.kind === 'info' && r.state === 'open' ? (
            <Field required>
              <FieldLabel>{r.label}</FieldLabel>
              {r.detail === null ? null : <FieldDescription>{r.detail}</FieldDescription>}
              <FieldControl>
                <Textarea
                  autoResize
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                  }}
                />
              </FieldControl>
            </Field>
          ) : null}
          {i !== undefined ? (
            changeAsked ? (
              <p className="text-sm">
                You have asked for a different time. Until the company moves it, this time stands.
              </p>
            ) : (
              <Field required>
                <FieldLabel>Ask for a different time</FieldLabel>
                <FieldDescription>
                  Say why, in a line, and when would suit you. The company hears at once; this time
                  stands until they move it.
                </FieldDescription>
                <FieldControl>
                  <Textarea
                    autoResize
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                    }}
                  />
                </FieldControl>
              </Field>
            )
          ) : null}
          {notice?.kind === 'answered' || notice?.kind === 'closed' ? (
            <p className="text-sm text-fg-muted">
              {r?.answer?.text ?? r?.detail ?? 'Nothing more to do here.'}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {r?.kind === 'slots' && r.state === 'open' ? (
            <Button
              loading={pending}
              disabled={time === '' || (time === 'none' && text.trim() === '')}
              onClick={() => {
                send(
                  `/me/asks/${r.id}`,
                  { time: time === 'none' ? null : time, text: text.trim() === '' ? null : text },
                  time === 'none'
                    ? 'Sent. They will offer other times.'
                    : 'Booked. The invitation is on its way.',
                );
              }}
            >
              {time === 'none' ? 'Ask for other times' : 'Book this time'}
            </Button>
          ) : null}
          {r?.kind === 'info' && r.state === 'open' ? (
            <Button
              loading={pending}
              disabled={text.trim() === ''}
              onClick={() => {
                send(`/me/asks/${r.id}`, { time: null, text }, 'Sent. Thank you.');
              }}
            >
              Send my answer
            </Button>
          ) : null}
          {i !== undefined && !changeAsked ? (
            <Button
              loading={pending}
              disabled={text.trim() === ''}
              onClick={() => {
                send(
                  `/me/interviews/${i.id}/change`,
                  { reason: text },
                  'Sent. The company will come back with new times.',
                );
              }}
            >
              Ask to move it
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The list itself: what needs the candidate first, each row opening its dialog. */
export function NoticeList({
  notices,
  onOpen,
  onOffer,
}: {
  readonly notices: readonly Notice[];
  readonly onOpen: (n: Notice) => void;
  /** An offer opens on the company's own page. */
  readonly onOffer: (n: Notice) => void;
}): JSX.Element {
  return (
    <List>
      {notices.map((n) => {
        const Icon = icons[ICON[n.kind]];
        return (
          <ListItem
            key={`${n.company.slug}:${n.id}`}
            asChild
            chevron
            leading={<Icon aria-hidden className="size-5 text-fg-muted" />}
            description={n.detail ?? undefined}
            trailing={
              n.open ? (
                <Badge size="sm" tone="warning">
                  Needs you
                </Badge>
              ) : n.kind === 'interview' ? (
                <Badge size="sm" tone="accent">
                  Booked
                </Badge>
              ) : null
            }
          >
            <button
              type="button"
              onClick={() => {
                if (n.kind === 'offer') onOffer(n);
                else onOpen(n);
              }}
            >
              {n.title}
            </button>
          </ListItem>
        );
      })}
    </List>
  );
}
