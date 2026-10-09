'use client';

import {
  Alert,
  Avatar,
  AvatarGroup,
  Badge,
  Button,
  ChangeDiff,
  ChatComposer,
  ChatLog,
  ChatMessage,
  Checkbox,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  KeyValues,
  Kbd,
  List,
  ListItem,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stepper,
  Switch,
  Textarea,
  icons,
} from '@reach/ui';
import {
  PeopleAskedDetail,
  PeopleChangeDetail,
  PeopleChecklistDetail,
  PeopleCorrectDetail,
  PeopleDetailsDetail,
  PeopleDocumentDetail,
  PeopleIntegrationDetail,
  PeopleReviewDetail,
  type InboxField,
} from '@kithena/contracts';
import { useEffect, useRef, useState, type JSX } from 'react';

import {
  actOnDocument,
  cancelAsk,
  changeAskBatch,
  completeAsk,
  documentFile,
  moveToDone,
  nudgeChange,
  replyToAsk,
  takeTask,
  tick,
  undoAsk,
  withdrawChange,
} from '../../app/(app)/inbox/actions';
import { checkIdentifiers, saveOwnSection } from '../../app/(app)/people/actions';
import { Actions, type BodyProps } from './pane';
import { ConfirmDialog, DueDialog, NoteDialog, SendBackDialog, SignDialog } from './dialogs';
import { firstName, when } from './format';

/**
 * People's kinds in the detail pane (INB-020 to INB-029): details to fill in,
 * a value to correct, a change of yours, what you asked of others, Review's
 * queues as one, a checklist, a document, an integration for every admin.
 */

type Values = Record<string, unknown>;

/** Text a field can be filled in with here; anything richer opens the profile. */
const INLINE = new Set([
  'text',
  'long_text',
  'email',
  'phone',
  'url',
  'number',
  'decimal',
  'percentage',
  'date',
  'select',
  'country',
  'boolean',
  'national_id',
]);

const shown = (v: unknown): string =>
  v === null || v === undefined || v === ''
    ? '—'
    : typeof v === 'boolean'
      ? v
        ? 'Yes'
        : 'No'
      : Array.isArray(v)
        ? v.map(String).join(', ')
        : typeof v === 'object'
          ? objectShown(v as Record<string, unknown>)
          : typeof v === 'string' || typeof v === 'number'
            ? String(v)
            : JSON.stringify(v);

const text = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : '';

/** A sealed value by its last four, an amount with its currency. */
function objectShown(o: Record<string, unknown>): string {
  if ('last4' in o) return `•••• ${text(o['last4'])}`;
  if ('amountMinor' in o) return `${text(o['amountMinor'])} ${text(o['currency'])}`;
  return JSON.stringify(o);
}

/** One field as a control, the way People draws it, or a way to its profile. */
function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  readonly field: InboxField;
  readonly value: unknown;
  readonly onChange: (v: unknown) => void;
  readonly disabled: boolean;
}): JSX.Element {
  const text = typeof value === 'string' ? value : '';
  if (!INLINE.has(field.dataType)) {
    return (
      <Field>
        <FieldLabel>{field.label}</FieldLabel>
        <FieldDescription>
          <a href="/people/me">Fill this in on your profile</a>
        </FieldDescription>
      </Field>
    );
  }
  if (field.dataType === 'boolean') {
    return (
      <Field orientation="horizontal" disabled={disabled}>
        <FieldLabel>{field.label}</FieldLabel>
        <FieldControl>
          <Switch checked={value === true} onCheckedChange={onChange} disabled={disabled} />
        </FieldControl>
      </Field>
    );
  }
  return (
    <Field required={field.required} disabled={disabled}>
      <FieldLabel>{field.label}</FieldLabel>
      {field.options.length > 0 ? (
        <Select value={text} onValueChange={onChange} disabled={disabled}>
          <FieldControl>
            <SelectTrigger>
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
          </FieldControl>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <FieldControl>
          {field.dataType === 'long_text' ? (
            <Textarea
              value={text}
              disabled={disabled}
              onChange={(e) => {
                onChange(e.target.value);
              }}
            />
          ) : (
            <Input
              value={text}
              disabled={disabled}
              type={
                field.dataType === 'date'
                  ? 'date'
                  : field.dataType === 'email'
                    ? 'email'
                    : field.dataType === 'phone'
                      ? 'tel'
                      : 'text'
              }
              inputMode={
                ['number', 'decimal', 'percentage'].includes(field.dataType) ? 'decimal' : undefined
              }
              onChange={(e) => {
                onChange(e.target.value);
              }}
            />
          )}
        </FieldControl>
      )}
      {field.description === null ? null : <FieldDescription>{field.description}</FieldDescription>}
      {field.sensitive ? (
        <FieldDescription>
          A change to this goes to HR before it is on your record.
        </FieldDescription>
      ) : null}
    </Field>
  );
}

/** C7, M:B6: the questions on a task, and a reply box. */
function Thread({
  askId,
  thread,
  sender,
  asking,
  act,
  closed,
}: {
  readonly askId: string;
  readonly thread: PeopleDetailsDetail['thread'];
  readonly sender: string;
  readonly asking: boolean;
  readonly act: BodyProps['act'];
  readonly closed: boolean;
}): JSX.Element | null {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (asking) box.current?.focus();
  }, [asking]);
  if (thread.length === 0 && !asking) return null;
  return (
    <section aria-label="Questions" className="flex flex-col gap-3">
      {thread.length === 0 ? null : (
        <ChatLog label="Questions on this task">
          {thread.map((m) => (
            <ChatMessage
              key={m.at}
              from={m.mine ? 'self' : 'other'}
              author={m.mine ? 'You' : m.author}
              meta={m.at.slice(11, 16)}
            >
              {m.body}
            </ChatMessage>
          ))}
        </ChatLog>
      )}
      {closed ? null : (
        <ChatComposer
          label={`Reply to ${sender}`}
          placeholder={`Reply to ${sender}…`}
          busy={act.pending}
          inputRef={box}
          onSend={(text) => {
            act.run(() => replyToAsk(askId, text), {
              title: 'Sent',
              description: `${sender} gets an update`,
            });
          }}
        />
      )}
    </section>
  );
}

/** C1, C7, C8, Z2: details somebody asked for, filled in here. */
function Details({
  item,
  zone,
  act,
  asking,
  setAsking,
  sendingBack,
  setSendingBack,
}: BodyProps): JSX.Element {
  const parsed = PeopleDetailsDetail.safeParse(item.detail);
  const detail = parsed.success ? parsed.data : null;
  const initial: Values = Object.fromEntries(
    (detail?.fields ?? []).map((f) => [f.key, f.value ?? '']),
  );
  const [values, setValues] = useState<Values>(initial);
  if (detail === null) return <Missing />;
  const sender = firstName(item.from?.name) || 'them';
  const open = detail.state === 'open';
  const cancelled = detail.state === 'cancelled';
  const filled = detail.fields.every((f) => !f.required || (values[f.key] ?? '') !== '');
  const changed = Object.fromEntries(
    Object.entries(values).filter(([k, v]) => v !== (initial[k] ?? '')),
  );
  const submit = (): void => {
    const previous = Object.fromEntries(detail.fields.map((f) => [f.key, f.value ?? null]));
    const labels = detail.fields.map((f) => f.label).join(', ');
    act.run(() => completeAsk(detail.askId, values), {
      title: `${labels} added`,
      description: `On your record now · ${sender} gets an update`,
      undo: () => undoAsk(detail.askId, previous),
      next: true,
    });
  };
  return (
    <div className="flex flex-col gap-4">
      {cancelled ? (
        <Alert
          tone="neutral"
          icon={<icons.blocked aria-hidden />}
          title={`${detail.closedBy ?? sender} cancelled this${detail.closedAt === null ? '' : ` on ${when(detail.closedAt, zone)}`}`}
        >
          {detail.note === null ? 'Nothing to do.' : `“${detail.note}”`}
        </Alert>
      ) : null}
      {detail.state === 'sent_back' ? (
        <Alert tone="neutral" title="You sent it back">
          {detail.note ?? 'With a reason, to whoever asked.'}
        </Alert>
      ) : null}
      {open || cancelled ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (open && filled) submit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && open && filled) {
              e.preventDefault();
              submit();
            }
          }}
        >
          {detail.fields.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              value={values[f.key]}
              disabled={!open}
              onChange={(v) => {
                setValues((was) => ({ ...was, [f.key]: v }));
              }}
            />
          ))}
          {open ? (
            <p className="text-sm text-fg-muted">
              {detail.fields.some((f) => f.sensitive)
                ? 'Some of this goes to HR first.'
                : 'It goes on your record straight away.'}
            </p>
          ) : null}
        </form>
      ) : (
        <KeyValues
          items={detail.fields.map((f) => ({ id: f.key, label: f.label, value: shown(f.value) }))}
        />
      )}
      <Thread
        askId={detail.askId}
        thread={detail.thread}
        sender={sender}
        asking={asking}
        act={act}
        closed={!open}
      />
      {open ? (
        <Actions
          hint={
            <span className="flex items-center gap-1.5">
              Submit <Kbd keyName="mod" /> <Kbd keyName="enter" />
            </span>
          }
        >
          <Button
            variant="primary"
            startIcon={<icons.confirm aria-hidden />}
            disabled={!filled || Object.keys(changed).length === 0}
            loading={act.pending}
            onClick={submit}
          >
            Add to my record
          </Button>
          <Button
            startIcon={<icons.message aria-hidden />}
            onClick={() => {
              setAsking(true);
            }}
          >
            {`Ask ${sender}`}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setSendingBack(true);
            }}
          >
            I can’t do this
          </Button>
        </Actions>
      ) : cancelled ? (
        <Actions hint="It moves on its own at midnight">
          <Button
            onClick={() => {
              act.run(() => moveToDone([item.id]), { title: 'Moved to Done', next: true });
            }}
          >
            Move to Done
          </Button>
        </Actions>
      ) : null}
      {sendingBack ? (
        <SendBackDialog
          sender={sender}
          onClose={() => {
            setSendingBack(false);
          }}
          act={act}
          askId={detail.askId}
        />
      ) : null}
    </div>
  );
}

/** C2, M:B2: a national identifier HR sent back, checked as it is typed. */
function CorrectBody({ item, act }: BodyProps): JSX.Element {
  const parsed = PeopleCorrectDetail.safeParse(item.detail);
  const key = parsed.success ? parsed.data.field.key : null;
  const [value, setValue] = useState('');
  const [check, setCheck] = useState<string | null>(null);
  useEffect(() => {
    if (key === null || value.trim().length < 4) {
      setCheck(null);
      return;
    }
    const timer = setTimeout(() => {
      void checkIdentifiers(null, '', { [key]: value }).then((found) => {
        if (!found.ok) return;
        const warnings = found.findings.map((f) => f['message'] ?? '').filter((m) => m !== '');
        setCheck(
          warnings.length === 0
            ? 'The check passes. HR still checks it against your document.'
            : warnings.join(' '),
        );
      });
    }, 350);
    return () => {
      clearTimeout(timer);
    };
  }, [value, key]);
  if (!parsed.success) return <Missing />;
  const { field, findings } = parsed.data;
  return (
    <div className="flex flex-col gap-4">
      {findings.length === 0 ? null : (
        <Alert tone="warning" title="What the check found">
          {findings.map((f) => f.message).join(' ')}
        </Alert>
      )}
      <Field required>
        <FieldLabel>{field.label}</FieldLabel>
        <FieldControl>
          <Input
            value={value}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setValue(e.target.value);
            }}
          />
        </FieldControl>
        {check === null ? null : <FieldDescription>{check}</FieldDescription>}
      </Field>
      <Actions hint="You’ll get an update when HR accepts it">
        <Button
          variant="primary"
          startIcon={<icons.send aria-hidden />}
          disabled={value.trim() === ''}
          loading={act.pending}
          onClick={() => {
            act.run(
              async () => {
                const saved = await saveOwnSection('', { [field.key]: value });
                return saved.ok ? { ok: true } : saved;
              },
              { title: `${field.label} sent to HR`, next: true },
            );
          }}
        >
          Send to HR
        </Button>
      </Actions>
    </div>
  );
}

/** E1, E2, D3, M:D2: a change you asked for, with HR or decided. */
function Change({ item, zone, now, act }: BodyProps): JSX.Element {
  const parsed = PeopleChangeDetail.safeParse(item.detail);
  const [withdrawing, setWithdrawing] = useState(false);
  if (!parsed.success) return <Missing />;
  const d = parsed.data;
  const current = d.steps.findIndex((s) => s.state === 'current');
  const canNudge = d.nudge !== null && !d.nudge.used && now >= d.nudge.from;
  return (
    <div className="flex flex-col gap-4">
      <ChangeDiff
        items={[
          {
            label: d.label,
            before: shown(d.before),
            after: shown(d.after),
          },
        ]}
      />
      <Stepper
        label="Where it is"
        orientation="vertical"
        size="sm"
        current={current === -1 ? d.steps.length : current}
        steps={d.steps.map((s, i) => ({
          id: String(i),
          label: s.label,
          ...(s.note === null ? {} : { description: s.note }),
          status: s.state === 'done' ? 'complete' : s.state === 'current' ? 'current' : 'upcoming',
        }))}
      />
      {d.note === null ? null : (
        <KeyValues items={[{ label: `${d.by ?? 'HR'}’s note`, value: `“${d.note}”` }]} />
      )}
      {d.state === 'pending' && item.lane === 'request' ? (
        <>
          <p className="text-sm text-fg-muted">
            {`Nothing changes on the record until HR decides. It takes effect from ${d.effectiveFrom}.`}
          </p>
          <Actions
            hint={
              d.nudge === null
                ? undefined
                : d.nudge.used
                  ? 'You nudged HR'
                  : canNudge
                    ? 'Nudge once'
                    : `You can nudge from ${when(d.nudge.from, zone)}`
            }
          >
            <Button
              startIcon={<icons.notifications aria-hidden />}
              disabled={!canNudge}
              loading={act.pending}
              onClick={() => {
                act.run(() => nudgeChange(d.changeId), { title: 'HR was nudged' });
              }}
            >
              Nudge HR
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setWithdrawing(true);
              }}
            >
              Withdraw
            </Button>
          </Actions>
        </>
      ) : null}
      {withdrawing ? (
        <ConfirmDialog
          title={`Withdraw your ${d.label.toLowerCase()} change?`}
          description={`HR stops seeing it and the record keeps ${shown(d.before)}. You can ask again any time.`}
          confirm="Withdraw"
          cancel="Keep it"
          onClose={() => {
            setWithdrawing(false);
          }}
          onConfirm={() => {
            setWithdrawing(false);
            act.run(() => withdrawChange(d.changeId), {
              title: 'Withdrawn',
              description: 'It moves to Done',
            });
          }}
        />
      ) : null}
    </div>
  );
}

/** H4: what you asked of one or many, with who has done it. */
function Asked({ item, act }: BodyProps): JSX.Element {
  const parsed = PeopleAskedDetail.safeParse(item.detail);
  const [dialog, setDialog] = useState<'due' | 'cancel' | null>(null);
  const [cancelling, setCancelling] = useState<{ askId: string; name: string } | null>(null);
  if (!parsed.success) return <Missing />;
  const d = parsed.data;
  const left = d.people.filter((p) => p.state === 'open');
  const finished = d.people.filter((p) => p.state === 'done');
  const live = left.length > 0;
  return (
    <div className="flex flex-col gap-4">
      <Progress
        label={`${String(d.done)} of ${String(d.total)} done`}
        value={d.total === 0 ? 0 : (d.done / d.total) * 100}
        showValue
        valueLabel={live ? `${String(left.length)} to go` : 'All done'}
      />
      {left.length === 0 ? null : (
        <List aria-label="Still to do it">
          {left.map((p) => (
            <ListItem
              key={p.askId}
              leading={<Avatar name={p.name} size="sm" />}
              description={
                p.replies > 0
                  ? `${String(p.replies)} question${p.replies === 1 ? '' : 's'}`
                  : undefined
              }
              trailing={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    act.run(
                      () => changeAskBatch(d.batchId, 'remind', { personIds: [p.personId] }),
                      {
                        title: `${p.name} reminded`,
                      },
                    );
                  }}
                >
                  Remind
                </Button>
              }
            >
              {p.name}
            </ListItem>
          ))}
        </List>
      )}
      {d.people.some((p) => p.state === 'sent_back') ? (
        <KeyValues
          items={d.people
            .filter((p) => p.state === 'sent_back')
            .map((p) => ({
              id: p.askId,
              label: `${p.name} sent it back`,
              value: p.note === null ? '—' : `“${p.note}”`,
            }))}
        />
      ) : null}
      {finished.length === 0 ? null : (
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <AvatarGroup size="xs" max={4}>
            {finished.map((p) => (
              <Avatar key={p.askId} name={p.name} />
            ))}
          </AvatarGroup>
          <span>{`${String(finished.length)} done`}</span>
        </div>
      )}
      {live ? (
        <Actions>
          <Button
            variant="primary"
            startIcon={<icons.notifications aria-hidden />}
            loading={act.pending}
            onClick={() => {
              act.run(() => changeAskBatch(d.batchId, 'remind'), {
                title: `Reminded ${String(left.length)}`,
                description: 'Anyone reminded in the last day is not emailed again',
              });
            }}
          >
            {left.length === 1 ? 'Remind' : `Remind the ${String(left.length)}`}
          </Button>
          <Button
            onClick={() => {
              setDialog('due');
            }}
          >
            Change due date
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDialog('cancel');
            }}
          >
            Cancel for everyone
          </Button>
        </Actions>
      ) : null}
      {dialog === 'due' ? (
        <DueDialog
          due={item.due}
          onClose={() => {
            setDialog(null);
          }}
          onPick={(dueOn) => {
            setDialog(null);
            act.run(() => changeAskBatch(d.batchId, 'due', { dueOn }), {
              title: 'Due date changed',
            });
          }}
        />
      ) : null}
      {cancelling === null ? null : (
        <NoteDialog
          title={`Cancel this for ${cancelling.name}?`}
          description="The fields lock, it stops counting for them, and they see your note."
          label="Note"
          confirm="Cancel it"
          optional
          onClose={() => {
            setCancelling(null);
          }}
          onConfirm={(note) => {
            const askId = cancelling.askId;
            setCancelling(null);
            act.run(() => cancelAsk(askId, note === '' ? null : note), { title: 'Cancelled' });
          }}
        />
      )}
      {dialog === 'cancel' ? (
        <ConfirmDialog
          title="Cancel this for everyone?"
          description="The fields lock for everyone still asked, and it leaves their To do."
          confirm="Cancel for everyone"
          cancel="Keep it"
          onClose={() => {
            setDialog(null);
          }}
          onConfirm={() => {
            setDialog(null);
            act.run(() => changeAskBatch(d.batchId, 'cancel'), { title: 'Cancelled for everyone' });
          }}
        />
      ) : null}
    </div>
  );
}

/** G2, M:G1: Review's queues, counted once. */
function Review({ item }: BodyProps): JSX.Element {
  const parsed = PeopleReviewDetail.safeParse(item.detail);
  if (!parsed.success) return <Missing />;
  return (
    <div className="flex flex-col gap-4">
      <List aria-label="Waiting in Review">
        {parsed.data.queues.map((q) => (
          <ListItem
            key={q.key}
            asChild
            icon={<icons.review aria-hidden />}
            description={q.by.length === 0 ? undefined : `From ${q.by.join(', ')}`}
            trailing={<Badge tone="warning">{q.count}</Badge>}
            chevron
          >
            <a href={q.link}>{q.label}</a>
          </ListItem>
        ))}
      </List>
      <p className="text-sm text-fg-muted">
        Review items keep their own tools: compare, the reasons for a flag, history. They aren’t
        copied here, so the two can’t disagree.
      </p>
      <Actions
        hint={
          <span className="flex items-center gap-1.5">
            Go to Review <Kbd>G</Kbd> <Kbd>R</Kbd>
          </span>
        }
      >
        <Button asChild variant="primary" startIcon={<icons.externalLink aria-hidden />}>
          <a href={item.link}>Open Review</a>
        </Button>
      </Actions>
    </div>
  );
}

/** S1, G5, M:S1: a checklist, each step done in place or where it lives. */
function Checklist({ item, act }: BodyProps): JSX.Element {
  const parsed = PeopleChecklistDetail.safeParse(item.detail);
  if (!parsed.success) return <Missing />;
  const d = parsed.data;
  const done = (s: (typeof d.steps)[number]) => s.done || item.ticks.includes(s.key);
  const count = d.steps.filter(done).length;
  const own = d.steps.every((s) => s.section === null && s.link === null);
  return (
    <div className="flex flex-col gap-4">
      <Progress
        label={own ? 'Your part' : 'Your checklist'}
        value={(count / Math.max(1, d.steps.length)) * 100}
        showValue
        valueLabel={`${String(count)} of ${String(d.steps.length)}`}
      />
      <List aria-label="Steps">
        {d.steps.map((s) => (
          <ListItem
            key={s.key}
            leading={
              <Checkbox
                aria-label={s.label}
                checked={done(s)}
                disabled={s.section !== null || s.link !== null || act.pending}
                onCheckedChange={(on) => {
                  act.run(() => tick(item.id, s.key, on === true));
                }}
              />
            }
            description={s.note ?? undefined}
            trailing={
              s.section !== null && !done(s) ? (
                <Button asChild size="sm">
                  <a href={`/people/onboarding#${s.section}`}>Fill in</a>
                </Button>
              ) : s.link !== null && !done(s) ? (
                <Button asChild size="sm">
                  <a href={s.link}>Open</a>
                </Button>
              ) : undefined
            }
          >
            {s.label}
          </ListItem>
        ))}
      </List>
      {d.others.length === 0 ? null : (
        <KeyValues items={d.others.map((o) => ({ label: o.name, value: o.note }))} />
      )}
      {own ? (
        <Actions
          hint={
            count < d.steps.length
              ? `Finish ${String(d.steps.length - count)} more step${d.steps.length - count === 1 ? '' : 's'}`
              : undefined
          }
        >
          <Button
            variant="primary"
            disabled={count < d.steps.length}
            onClick={() => {
              act.run(() => moveToDone([item.id]), { title: 'Done', next: true });
            }}
          >
            Mark done
          </Button>
        </Actions>
      ) : (
        <Actions hint="HR and your manager can see how far you are">
          <Button asChild variant="ghost" size="sm" startIcon={<icons.externalLink aria-hidden />}>
            <a href={item.link}>Open onboarding</a>
          </Button>
        </Actions>
      )}
    </div>
  );
}

const size = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${String(Math.max(1, Math.round(bytes / 1024)))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Open the document's file in a new tab, from its bytes: never a link anybody else can use. */
async function openFile(documentId: string, download: boolean): Promise<boolean> {
  const file = await documentFile(documentId);
  if (file === null) return false;
  const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mediaType }));
  if (download) {
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
  } else {
    window.open(url, '_blank', 'noopener');
  }
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
  return true;
}

/** C3, C4, D2, F1, M:B3, M:C3: a document to keep, acknowledge, sign or countersign. */
function Document({ item, zone, act }: BodyProps): JSX.Element {
  const parsed = PeopleDocumentDetail.safeParse(item.detail);
  const [seen, setSeen] = useState(false);
  const [dialog, setDialog] = useState<'sign' | 'countersign' | 'decline' | null>(null);
  if (!parsed.success) return <Missing />;
  const d = parsed.data;
  const sender = firstName(d.sentBy) || 'HR';
  const preview = (download: boolean): void => {
    void openFile(d.documentId, download).then((ok) => {
      if (ok && !download) setSeen(true);
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <List aria-label="Document">
        <ListItem
          icon={<icons.file aria-hidden />}
          description={`${size(d.size)} · ${d.mediaType === 'application/pdf' ? 'PDF' : 'Image'}`}
          trailing={
            <>
              <Button
                size="sm"
                variant="ghost"
                startIcon={<icons.visible aria-hidden />}
                onClick={() => {
                  preview(false);
                }}
              >
                Preview
              </Button>
              <Button
                size="sm"
                variant="ghost"
                startIcon={<icons.download aria-hidden />}
                onClick={() => {
                  preview(true);
                }}
              >
                Download
              </Button>
            </>
          }
        >
          {d.name}
        </ListItem>
      </List>
      <KeyValues
        items={[
          { label: 'Sent by', value: d.sentBy },
          ...(d.signature === null
            ? []
            : [
                {
                  label: 'Signed',
                  value: `${when(d.signature.at, zone)}${d.signature.place === null ? '' : ` · ${d.signature.place}`} · ${d.signature.name}`,
                },
              ]),
          ...(d.countersigned === null
            ? d.countersigner === null || d.mode !== 'sign'
              ? []
              : [
                  {
                    label: 'Countersigned by',
                    value: d.state === 'signed' ? `${d.countersigner} (waiting)` : d.countersigner,
                  },
                ]
            : [
                {
                  label: 'Countersigned',
                  value: `${when(d.countersigned.at, zone)} · ${d.countersigned.name}`,
                },
              ]),
          ...(d.note === null ? [] : [{ label: 'Note', value: `“${d.note}”` }]),
          {
            label: 'Kept in',
            value: `${d.personName === 'You' ? 'Your' : `${d.personName}’s`} profile › Documents`,
          },
        ]}
      />
      {d.action === 'sign' || d.action === 'acknowledge' ? (
        <Actions hint={seen ? undefined : 'Open it first'}>
          <Button
            variant="primary"
            startIcon={<icons.edit aria-hidden />}
            disabled={!seen}
            loading={act.pending}
            onClick={() => {
              if (d.action === 'sign') setDialog('sign');
              else
                act.run(() => actOnDocument(d.documentId, 'acknowledge'), {
                  title: 'Acknowledged',
                  description: `${sender} gets an update`,
                  next: true,
                });
            }}
          >
            {d.action === 'sign' ? 'Sign' : 'I’ve read it'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDialog('decline');
            }}
          >
            {d.action === 'sign' ? 'I can’t sign this' : 'I can’t do this'}
          </Button>
        </Actions>
      ) : d.action === 'countersign' ? (
        <Actions>
          <Button
            variant="primary"
            startIcon={<icons.edit aria-hidden />}
            onClick={() => {
              setDialog('countersign');
            }}
          >
            Countersign
          </Button>
        </Actions>
      ) : null}
      {dialog === 'sign' || dialog === 'countersign' ? (
        <SignDialog
          documentName={d.name}
          counter={dialog === 'countersign'}
          onClose={() => {
            setDialog(null);
          }}
          onSign={(signature) => {
            setDialog(null);
            act.run(
              () =>
                dialog === 'countersign'
                  ? actOnDocument(d.documentId, 'countersign', { name: signature.name })
                  : actOnDocument(d.documentId, 'sign', signature),
              {
                title: dialog === 'countersign' ? 'Countersigned' : 'Signed',
                description: 'Kept in the profile under Documents',
                next: true,
              },
            );
          }}
        />
      ) : null}
      {dialog === 'decline' ? (
        <NoteDialog
          title={`Send this back to ${sender}?`}
          description={`It leaves your To do. ${sender} gets an update with your reason.`}
          label={`Note for ${sender}`}
          confirm="Send back"
          onClose={() => {
            setDialog(null);
          }}
          onConfirm={(note) => {
            setDialog(null);
            act.run(() => actOnDocument(d.documentId, 'send-back', { note }), {
              title: 'Sent back',
              next: true,
            });
          }}
        />
      ) : null}
    </div>
  );
}

/** H1, Z3, M:G1: an integration failing, for every admin; one takes it. */
function Integration({ item, zone, act }: BodyProps): JSX.Element {
  const parsed = PeopleIntegrationDetail.safeParse(item.detail);
  const [over, setOver] = useState(false);
  if (!parsed.success || item.team === null) return <Missing />;
  const d = parsed.data;
  const team = item.team;
  const taken = team.takenBy !== null;
  return (
    <div className="flex flex-col gap-4">
      <Alert
        tone="danger"
        title={
          d.disabled ? 'Sending is switched off' : `Failed ${String(d.attempts)} times in a row`
        }
      >
        {d.problem ??
          `The last answer was ${d.lastResponse === null ? 'no answer at all' : `HTTP ${String(d.lastResponse)}`}. Nothing new reaches it until it is fixed.`}
      </Alert>
      <KeyValues
        items={[
          { label: 'Failing since', value: when(d.since, zone) },
          { label: 'Waiting to send', value: String(d.waiting) },
          { label: 'Who sees this', value: team.role },
          ...(d.note === null ? [] : [{ label: 'Note', value: `“${d.note}”` }]),
        ]}
      />
      <Actions
        hint={
          !taken
            ? 'Taking it tells the other admins you’re on it'
            : team.mine
              ? 'You’re on it'
              : `${team.takenBy?.name ?? 'Somebody'} took it${team.takenAt === null ? '' : ` at ${when(team.takenAt, zone)}`}`
        }
      >
        {taken ? null : (
          <Button
            variant="primary"
            loading={act.pending}
            onClick={() => {
              act.run(() => takeTask(item.id, null), {
                title: 'It’s yours',
                description: 'It stops counting for the other admins',
              });
            }}
          >
            Take it
          </Button>
        )}
        <Button asChild startIcon={<icons.externalLink aria-hidden />}>
          <a href={item.link}>Open in Integrations</a>
        </Button>
        {taken && !team.mine ? (
          <Button
            variant="ghost"
            onClick={() => {
              setOver(true);
            }}
          >
            Take it over
          </Button>
        ) : null}
      </Actions>
      {over ? (
        <NoteDialog
          title="Take it over?"
          description={`${team.takenBy?.name ?? 'Whoever has it'} sees that you have it now.`}
          label="Note"
          confirm="Take it over"
          optional
          onClose={() => {
            setOver(false);
          }}
          onConfirm={(note) => {
            setOver(false);
            act.run(() => takeTask(item.id, note === '' ? null : note), {
              title: 'It’s yours now',
            });
          }}
        />
      ) : null}
    </div>
  );
}

/** Everything else People posts: the item, and where it lives. */
function Plain({ item }: BodyProps): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {item.summary === null ? null : <p className="text-base text-fg-muted">{item.summary}</p>}
      <Actions>
        <Button asChild startIcon={<icons.externalLink aria-hidden />}>
          <a href={item.link}>{`Open in ${item.openIn}`}</a>
        </Button>
      </Actions>
    </div>
  );
}

function Missing(): JSX.Element {
  return (
    <Alert tone="warning" title="This can’t be shown here">
      Open it where it lives instead.
    </Alert>
  );
}

export function PeopleBody(props: BodyProps): JSX.Element {
  switch (props.item.kind) {
    case 'people.details':
      return <Details {...props} />;
    case 'people.correct':
      return <CorrectBody {...props} />;
    case 'people.change':
      return <Change {...props} />;
    case 'people.asked':
      return <Asked {...props} />;
    case 'people.review':
      return <Review {...props} />;
    case 'people.checklist':
      return <Checklist {...props} />;
    case 'people.document':
      return <Document {...props} />;
    case 'people.integration':
      return <Integration {...props} />;
    default:
      return <Plain {...props} />;
  }
}
