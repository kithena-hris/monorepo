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
  formatList,
  formatNumber,
  icons,
  Input,
  Kbd,
  KeyValues,
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
import { Suspense, lazy, useEffect, useRef, useState, type JSX } from 'react';

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
import { Actions, type BodyProps, OpenHere, useOpenHereClick } from './pane';
import { ConfirmDialog, NoteDialog, SendBackDialog, SignDialog } from './dialogs';
import { firstName, when } from './format';
import { t } from '../../lib/t';

// Picks a date or time: its own chunk, fetched when it opens (`dated-dialogs.tsx`).
const DueDialog = lazy(() => import('./dated-dialogs').then((m) => ({ default: m.DueDialog })));

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
        ? t('components.inbox.detail-people.yes', 'Yes')
        : t('components.inbox.detail-people.no', 'No')
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
  if ('amountMinor' in o)
    return typeof o['amountMinor'] === 'number' && typeof o['currency'] === 'string'
      ? formatNumber(o['amountMinor'] / 100, { style: 'currency', currency: o['currency'] })
      : `${text(o['amountMinor'])} ${text(o['currency'])}`;
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
  const here = useOpenHereClick();
  const text = typeof value === 'string' ? value : '';
  if (!INLINE.has(field.dataType)) {
    return (
      <Field>
        <FieldLabel>{field.label}</FieldLabel>
        <FieldDescription>
          <a href="/people/me" onClick={here('/people/me')}>
            {t(
              'components.inbox.detail-people.fill_this_in_on_your_profile',
              'Fill this in on your profile',
            )}
          </a>
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
              <SelectValue placeholder={t('components.inbox.detail-people.choose', 'Choose')} />
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
          {t(
            'components.inbox.detail-people.a_change_to_this_goes_to',
            'A change to this goes to HR before it is on your record.',
          )}
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
    <section
      aria-label={t('components.inbox.detail-people.questions', 'Questions')}
      className="flex flex-col gap-3"
    >
      {thread.length === 0 ? null : (
        <ChatLog
          label={t(
            'components.inbox.detail-people.questions_on_this_task',
            'Questions on this task',
          )}
        >
          {thread.map((m) => (
            <ChatMessage
              key={m.at}
              from={m.mine ? 'self' : 'other'}
              author={m.mine ? t('components.inbox.detail-people.you', 'You') : m.author}
              meta={m.at.slice(11, 16)}
            >
              {m.body}
            </ChatMessage>
          ))}
        </ChatLog>
      )}
      {closed ? null : (
        <ChatComposer
          label={t('components.inbox.detail-people.reply_to', 'Reply to {{sender}}', { sender })}
          placeholder={t('components.inbox.detail-people.reply_to_2', 'Reply to {{sender}}…', {
            sender,
          })}
          busy={act.pending}
          inputRef={box}
          onSend={(text) => {
            act.run(() => replyToAsk(askId, text), {
              title: t('components.inbox.detail-people.sent', 'Sent'),
              description: t(
                'components.inbox.detail-people.sender_gets_an_update',
                '{{sender}} gets an update',
                { sender },
              ),
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
    const labels = formatList(detail.fields.map((f) => f.label));
    act.run(() => completeAsk(detail.askId, values), {
      title: t('components.inbox.detail-people.labels_added', '{{labels}} added', { labels }),
      description: t(
        'components.inbox.detail-people.on_your_record_now',
        'On your record now · {{sender}} gets an update',
        { sender },
      ),
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
          title={t(
            'components.inbox.detail-people.cancelled_this',
            '{{value}} cancelled this{{value2}}',
            {
              value: detail.closedBy ?? sender,
              value2:
                detail.closedAt === null
                  ? ''
                  : ' ' +
                    t('components.inbox.detail-people.on', 'on {{closedAt}}', {
                      closedAt: when(detail.closedAt, zone),
                    }),
            },
          )}
        >
          {detail.note === null
            ? t('components.inbox.detail-people.nothing_to_do', 'Nothing to do.')
            : `“${detail.note}”`}
        </Alert>
      ) : null}
      {detail.state === 'sent_back' ? (
        <Alert
          tone="neutral"
          title={t('components.inbox.detail-people.you_sent_it_back', 'You sent it back')}
        >
          {detail.note ??
            t(
              'components.inbox.detail-people.with_a_reason_to_whoever_asked',
              'With a reason, to whoever asked.',
            )}
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
                ? t(
                    'components.inbox.detail-people.some_of_this_goes_to_hr',
                    'Some of this goes to HR first.',
                  )
                : t(
                    'components.inbox.detail-people.it_goes_on_your_record_straight',
                    'It goes on your record straight away.',
                  )}
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
              {t('components.inbox.detail-people.submit', 'Submit')} <Kbd keyName="mod" />{' '}
              <Kbd keyName="enter" />
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
            {t('components.inbox.detail-people.add_to_my_record', 'Add to my record')}
          </Button>
          <Button
            startIcon={<icons.message aria-hidden />}
            onClick={() => {
              setAsking(true);
            }}
          >
            {t('components.inbox.detail-people.ask', 'Ask {{sender}}', { sender })}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setSendingBack(true);
            }}
          >
            {t('components.inbox.detail-people.i_cant_do_this', 'I can’t do this')}
          </Button>
        </Actions>
      ) : cancelled ? (
        <Actions
          hint={t(
            'components.inbox.detail-people.it_moves_on_its_own_at',
            'It moves on its own at midnight',
          )}
        >
          <Button
            onClick={() => {
              act.run(() => moveToDone([item.id]), {
                title: t('components.inbox.detail-people.moved_to_done', 'Moved to Done'),
                next: true,
              });
            }}
          >
            {t('components.inbox.detail-people.move_to_done', 'Move to Done')}
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
            ? t(
                'components.inbox.detail-people.the_check_passes_hr_still_checks',
                'The check passes. HR still checks it against your document.',
              )
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
        <Alert
          tone="warning"
          title={t('components.inbox.detail-people.what_the_check_found', 'What the check found')}
        >
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
      <Actions
        hint={t(
          'components.inbox.detail-people.youll_get_an_update_when_hr',
          'You’ll get an update when HR accepts it',
        )}
      >
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
              {
                title: t(
                  'components.inbox.detail-people.field_sent_to_hr',
                  '{{field}} sent to HR',
                  { field: field.label },
                ),
                next: true,
              },
            );
          }}
        >
          {t('components.inbox.detail-people.send_to_hr', 'Send to HR')}
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
        label={t('components.inbox.detail-people.where_it_is', 'Where it is')}
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
        <KeyValues
          items={[
            {
              label:
                d.by === null
                  ? t('components.inbox.detail-people.hrs_note', 'HR’s note')
                  : t('components.inbox.detail-people.persons_note', '{{name}}’s note', {
                      name: d.by,
                    }),
              value: `“${d.note}”`,
            },
          ]}
        />
      )}
      {d.state === 'pending' && item.lane === 'request' ? (
        <>
          <p className="text-sm text-fg-muted">
            {t(
              'components.inbox.detail-people.nothing_changes_on_the_record_until',
              'Nothing changes on the record until HR decides. It takes effect from {{effectiveFrom}}.',
              { effectiveFrom: d.effectiveFrom },
            )}
          </p>
          <Actions
            hint={
              d.nudge === null
                ? undefined
                : d.nudge.used
                  ? t('components.inbox.detail-people.you_nudged_hr', 'You nudged HR')
                  : canNudge
                    ? t('components.inbox.detail-people.nudge_once', 'Nudge once')
                    : t(
                        'components.inbox.detail-people.you_can_nudge_from',
                        'You can nudge from {{from}}',
                        { from: when(d.nudge.from, zone) },
                      )
            }
          >
            <Button
              startIcon={<icons.notifications aria-hidden />}
              disabled={!canNudge}
              loading={act.pending}
              onClick={() => {
                act.run(() => nudgeChange(d.changeId), {
                  title: t('components.inbox.detail-people.hr_was_nudged', 'HR was nudged'),
                });
              }}
            >
              {t('components.inbox.detail-people.nudge_hr', 'Nudge HR')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setWithdrawing(true);
              }}
            >
              {t('components.inbox.detail-people.withdraw', 'Withdraw')}
            </Button>
          </Actions>
        </>
      ) : null}
      {withdrawing ? (
        <ConfirmDialog
          title={t(
            'components.inbox.detail-people.withdraw_your_change',
            'Withdraw your {{label}} change?',
            { label: d.label.toLowerCase() },
          )}
          description={t(
            'components.inbox.detail-people.hr_stops_seeing_it_and_the',
            'HR stops seeing it and the record keeps {{shown}}. You can ask again any time.',
            { shown: shown(d.before) },
          )}
          confirm={t('components.inbox.detail-people.withdraw', 'Withdraw')}
          cancel={t('components.inbox.detail-people.keep_it', 'Keep it')}
          onClose={() => {
            setWithdrawing(false);
          }}
          onConfirm={() => {
            setWithdrawing(false);
            act.run(() => withdrawChange(d.changeId), {
              title: t('components.inbox.detail-people.withdrawn', 'Withdrawn'),
              description: t('components.inbox.detail-people.it_moves_to_done', 'It moves to Done'),
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
        label={t('components.inbox.detail-people.of_done', '{{done}} of {{total}} done', {
          done: String(d.done),
          total: String(d.total),
        })}
        value={d.total === 0 ? 0 : (d.done / d.total) * 100}
        showValue
        valueLabel={
          live
            ? t('components.inbox.detail-people.to_go', '{{length}} to go', {
                length: String(left.length),
              })
            : t('components.inbox.detail-people.all_done', 'All done')
        }
      />
      {left.length === 0 ? null : (
        <List aria-label={t('components.inbox.detail-people.still_to_do_it', 'Still to do it')}>
          {left.map((p) => (
            <ListItem
              key={p.askId}
              leading={<Avatar name={p.name} size="sm" />}
              description={
                p.replies > 0
                  ? t(
                      'components.inbox.detail-people.question',
                      { one: '{{count}} question', other: '{{count}} questions' },
                      { count: p.replies },
                    )
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
                        title: t('components.inbox.detail-people.reminded', '{{name}} reminded', {
                          name: p.name,
                        }),
                      },
                    );
                  }}
                >
                  {t('components.inbox.detail-people.remind', 'Remind')}
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
              label: t('components.inbox.detail-people.sent_it_back', '{{name}} sent it back', {
                name: p.name,
              }),
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
          <span>
            {t('components.inbox.detail-people.done', '{{length}} done', {
              length: String(finished.length),
            })}
          </span>
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
                title: t(
                  'components.inbox.detail-people.reminded_count',
                  { one: 'Reminded {{count}} person', other: 'Reminded {{count}} people' },
                  { count: left.length },
                ),
                description: t(
                  'components.inbox.detail-people.anyone_reminded_in_the_last_day_is',
                  'Anyone reminded in the last day is not emailed again',
                ),
              });
            }}
          >
            {left.length === 1
              ? t('components.inbox.detail-people.remind', 'Remind')
              : t('components.inbox.detail-people.remind_the', 'Remind the {{length}}', {
                  length: String(left.length),
                })}
          </Button>
          <Button
            onClick={() => {
              setDialog('due');
            }}
          >
            {t('components.inbox.detail-people.change_due_date', 'Change due date')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDialog('cancel');
            }}
          >
            {t('components.inbox.detail-people.cancel_for_everyone', 'Cancel for everyone')}
          </Button>
        </Actions>
      ) : null}
      {dialog === 'due' ? (
        <Suspense fallback={null}>
          <DueDialog
            due={item.due}
            onClose={() => {
              setDialog(null);
            }}
            onPick={(dueOn) => {
              setDialog(null);
              act.run(() => changeAskBatch(d.batchId, 'due', { dueOn }), {
                title: t('components.inbox.detail-people.due_date_changed', 'Due date changed'),
              });
            }}
          />
        </Suspense>
      ) : null}
      {cancelling === null ? null : (
        <NoteDialog
          title={t('components.inbox.detail-people.cancel_this_for', 'Cancel this for {{name}}?', {
            name: cancelling.name,
          })}
          description={t(
            'components.inbox.detail-people.the_fields_lock_it_stops_counting',
            'The fields lock, it stops counting for them, and they see your note.',
          )}
          label={t('components.inbox.detail-people.note', 'Note')}
          confirm={t('components.inbox.detail-people.cancel_it', 'Cancel it')}
          optional
          onClose={() => {
            setCancelling(null);
          }}
          onConfirm={(note) => {
            const askId = cancelling.askId;
            setCancelling(null);
            act.run(() => cancelAsk(askId, note === '' ? null : note), {
              title: t('components.inbox.detail-people.cancelled', 'Cancelled'),
            });
          }}
        />
      )}
      {dialog === 'cancel' ? (
        <ConfirmDialog
          title={t(
            'components.inbox.detail-people.cancel_this_for_everyone',
            'Cancel this for everyone?',
          )}
          description={t(
            'components.inbox.detail-people.the_fields_lock_for_everyone_still',
            'The fields lock for everyone still asked, and it leaves their To do.',
          )}
          confirm={t('components.inbox.detail-people.cancel_for_everyone', 'Cancel for everyone')}
          cancel={t('components.inbox.detail-people.keep_it', 'Keep it')}
          onClose={() => {
            setDialog(null);
          }}
          onConfirm={() => {
            setDialog(null);
            act.run(() => changeAskBatch(d.batchId, 'cancel'), {
              title: t(
                'components.inbox.detail-people.cancelled_for_everyone',
                'Cancelled for everyone',
              ),
            });
          }}
        />
      ) : null}
    </div>
  );
}

/** G2, M:G1: Review's queues, counted once. */
function Review({ item }: BodyProps): JSX.Element {
  const here = useOpenHereClick();
  const parsed = PeopleReviewDetail.safeParse(item.detail);
  if (!parsed.success) return <Missing />;
  return (
    <div className="flex flex-col gap-4">
      <List aria-label={t('components.inbox.detail-people.waiting_in_review', 'Waiting in Review')}>
        {parsed.data.queues.map((q) => (
          <ListItem
            key={q.key}
            asChild
            icon={<icons.review aria-hidden />}
            description={
              q.by.length === 0
                ? undefined
                : t('components.inbox.detail-people.from', 'From {{join}}', {
                    join: q.by.join(', '),
                  })
            }
            trailing={<Badge tone="warning">{q.count}</Badge>}
            chevron
          >
            <a href={q.link} onClick={here(q.link)}>
              {q.label}
            </a>
          </ListItem>
        ))}
      </List>
      <p className="text-sm text-fg-muted">
        {t(
          'components.inbox.detail-people.review_items_keep_their_own_tools',
          'Review items keep their own tools: compare, the reasons for a flag, history. They aren’t copied here, so the two can’t disagree.',
        )}
      </p>
      <Actions
        hint={
          <span className="flex items-center gap-1.5">
            {t('components.inbox.detail-people.go_to_review', 'Go to Review')} <Kbd>G</Kbd>{' '}
            <Kbd>R</Kbd>
          </span>
        }
      >
        <OpenHere href={item.link} variant="primary">
          {t('components.inbox.detail-people.open_review', 'Open Review')}
        </OpenHere>
      </Actions>
    </div>
  );
}

/**
 * S1, G5, M:S1: a checklist, each step done in place. A section's step asks
 * here for what it still needs, its required fields left empty, and nothing
 * else: not the whole profile, not the fields already filled.
 */
function Checklist({ item, act }: BodyProps): JSX.Element {
  const parsed = PeopleChecklistDetail.safeParse(item.detail);
  const [values, setValues] = useState<Values>({});
  if (!parsed.success) return <Missing />;
  const d = parsed.data;
  const done = (s: (typeof d.steps)[number]) => s.done || item.ticks.includes(s.key);
  const count = d.steps.filter(done).length;
  const own = d.steps.every((s) => s.section === null && s.link === null);
  const asking = d.steps.filter((s) => !done(s) && (s.fields?.length ?? 0) > 0);
  const rest = d.steps.filter((s) => !asking.includes(s));
  const filled = (v: unknown): boolean => v !== undefined && v !== null && v !== '';
  const changed = Object.fromEntries(Object.entries(values).filter(([, v]) => filled(v)));
  const complete =
    asking.every((s) => (s.fields ?? []).every((f) => filled(values[f.key]))) && rest.every(done);
  const save = (): void => {
    act.run(() => saveOwnSection('', changed), {
      title: t('components.inbox.detail-people.saved_to_your_profile', 'Saved to your profile'),
      next: complete,
    });
  };
  return (
    <div className="flex flex-col gap-5">
      <Progress
        label={
          own
            ? t('components.inbox.detail-people.your_part', 'Your part')
            : t('components.inbox.detail-people.your_checklist', 'Your checklist')
        }
        value={(count / Math.max(1, d.steps.length)) * 100}
        showValue
        valueLabel={t('components.inbox.detail-people.of', '{{count}} of {{length}}', {
          count: String(count),
          length: String(d.steps.length),
        })}
      />
      {asking.length === 0 ? null : (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (Object.keys(changed).length > 0) save();
          }}
        >
          {asking.map((s) => (
            <section key={s.key} aria-label={s.label} className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-fg">{s.label}</h3>
              {(s.fields ?? []).map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={values[f.key]}
                  disabled={act.pending}
                  onChange={(v) => {
                    setValues((was) => ({ ...was, [f.key]: v }));
                  }}
                />
              ))}
            </section>
          ))}
          <Actions
            hint={
              asking.some((s) => (s.fields ?? []).some((f) => f.sensitive))
                ? t(
                    'components.inbox.detail-people.some_of_this_goes_to_hr',
                    'Some of this goes to HR first.',
                  )
                : undefined
            }
          >
            <Button
              type="submit"
              variant="primary"
              loading={act.pending}
              disabled={Object.keys(changed).length === 0}
            >
              {t('components.inbox.detail-people.save', 'Save')}
            </Button>
          </Actions>
        </form>
      )}
      {rest.length === 0 ? null : (
        <List aria-label={t('components.inbox.detail-people.steps', 'Steps')}>
          {rest.map((s) => (
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
                  <OpenHere href={`/people/onboarding#${s.section}`} size="sm">
                    {t('components.inbox.detail-people.fill_in', 'Fill in')}
                  </OpenHere>
                ) : s.link !== null && !done(s) ? (
                  <OpenHere href={s.link} size="sm">
                    {t('components.inbox.detail-people.open', 'Open')}
                  </OpenHere>
                ) : undefined
              }
            >
              {s.label}
            </ListItem>
          ))}
        </List>
      )}
      {d.others.length === 0 ? null : (
        <KeyValues items={d.others.map((o) => ({ label: o.name, value: o.note }))} />
      )}
      {own ? (
        <Actions
          hint={
            count < d.steps.length
              ? t(
                  'components.inbox.detail-people.finish_more_step',
                  { one: 'Finish {{count}} more step', other: 'Finish {{count}} more steps' },
                  { count: d.steps.length - count },
                )
              : undefined
          }
        >
          <Button
            variant="primary"
            disabled={count < d.steps.length}
            onClick={() => {
              act.run(() => moveToDone([item.id]), {
                title: t('components.inbox.detail-people.done_2', 'Done'),
                next: true,
              });
            }}
          >
            {t('components.inbox.detail-people.mark_done', 'Mark done')}
          </Button>
        </Actions>
      ) : (
        <p className="text-sm text-fg-subtle">
          {t(
            'components.inbox.detail-people.hr_and_your_manager_can_see',
            'HR and your manager can see how far you are',
          )}
        </p>
      )}
    </div>
  );
}

const size = (bytes: number): string =>
  bytes < 1024 * 1024
    ? formatNumber(Math.max(1, Math.round(bytes / 1024)), { style: 'unit', unit: 'kilobyte' })
    : formatNumber(bytes / 1024 / 1024, {
        style: 'unit',
        unit: 'megabyte',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });

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
      <List aria-label={t('components.inbox.detail-people.document', 'Document')}>
        <ListItem
          icon={<icons.file aria-hidden />}
          description={t('components.inbox.detail-people.text_2', '{{size}} · {{value}}', {
            size: size(d.size),
            value:
              d.mediaType === 'application/pdf'
                ? t('components.inbox.detail-people.pdf', 'PDF')
                : t('components.inbox.detail-people.image', 'Image'),
          })}
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
                {t('components.inbox.detail-people.preview', 'Preview')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                startIcon={<icons.download aria-hidden />}
                onClick={() => {
                  preview(true);
                }}
              >
                {t('components.inbox.detail-people.download', 'Download')}
              </Button>
            </>
          }
        >
          {d.name}
        </ListItem>
      </List>
      <KeyValues
        items={[
          { label: t('components.inbox.detail-people.sent_by', 'Sent by'), value: d.sentBy },
          ...(d.signature === null
            ? []
            : [
                {
                  label: t('components.inbox.detail-people.signed', 'Signed'),
                  value: `${when(d.signature.at, zone)}${d.signature.place === null ? '' : ` · ${d.signature.place}`} · ${d.signature.name}`,
                },
              ]),
          ...(d.countersigned === null
            ? d.countersigner === null || d.mode !== 'sign'
              ? []
              : [
                  {
                    label: t('components.inbox.detail-people.countersigned_by', 'Countersigned by'),
                    value: d.state === 'signed' ? `${d.countersigner} (waiting)` : d.countersigner,
                  },
                ]
            : [
                {
                  label: t('components.inbox.detail-people.countersigned', 'Countersigned'),
                  value: `${when(d.countersigned.at, zone)} · ${d.countersigned.name}`,
                },
              ]),
          ...(d.note === null
            ? []
            : [{ label: t('components.inbox.detail-people.note', 'Note'), value: `“${d.note}”` }]),
          {
            label: t('components.inbox.detail-people.kept_in', 'Kept in'),
            value: `${d.personName === 'You' ? 'Your' : `${d.personName}’s`} profile › Documents`,
          },
        ]}
      />
      {d.action === 'sign' || d.action === 'acknowledge' ? (
        <Actions
          hint={
            seen ? undefined : t('components.inbox.detail-people.open_it_first', 'Open it first')
          }
        >
          <Button
            variant="primary"
            startIcon={<icons.edit aria-hidden />}
            disabled={!seen}
            loading={act.pending}
            onClick={() => {
              if (d.action === 'sign') setDialog('sign');
              else
                act.run(() => actOnDocument(d.documentId, 'acknowledge'), {
                  title: t('components.inbox.detail-people.acknowledged', 'Acknowledged'),
                  description: t(
                    'components.inbox.detail-people.sender_gets_an_update',
                    '{{sender}} gets an update',
                    { sender },
                  ),
                  next: true,
                });
            }}
          >
            {d.action === 'sign'
              ? t('components.inbox.detail-people.sign', 'Sign')
              : t('components.inbox.detail-people.ive_read_it', 'I’ve read it')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDialog('decline');
            }}
          >
            {d.action === 'sign'
              ? t('components.inbox.detail-people.i_cant_sign_this', 'I can’t sign this')
              : t('components.inbox.detail-people.i_cant_do_this', 'I can’t do this')}
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
            {t('components.inbox.detail-people.countersign', 'Countersign')}
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
                title:
                  dialog === 'countersign'
                    ? t('components.inbox.detail-people.countersigned', 'Countersigned')
                    : t('components.inbox.detail-people.signed', 'Signed'),
                description: t(
                  'components.inbox.detail-people.kept_in_the_profile_under_documents',
                  'Kept in the profile under Documents',
                ),
                next: true,
              },
            );
          }}
        />
      ) : null}
      {dialog === 'decline' ? (
        <NoteDialog
          title={t(
            'components.inbox.detail-people.send_this_back_to',
            'Send this back to {{sender}}?',
            { sender },
          )}
          description={t(
            'components.inbox.detail-people.it_leaves_your_to_do_gets',
            'It leaves your To do. {{sender}} gets an update with your reason.',
            { sender },
          )}
          label={t('components.inbox.detail-people.note_for', 'Note for {{sender}}', { sender })}
          confirm={t('components.inbox.detail-people.send_back', 'Send back')}
          onClose={() => {
            setDialog(null);
          }}
          onConfirm={(note) => {
            setDialog(null);
            act.run(() => actOnDocument(d.documentId, 'send-back', { note }), {
              title: t('components.inbox.detail-people.sent_back', 'Sent back'),
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
          d.disabled
            ? t('components.inbox.detail-people.sending_is_switched_off', 'Sending is switched off')
            : t(
                'components.inbox.detail-people.failed_times_in_a_row',
                'Failed {{attempts}} times in a row',
                { attempts: String(d.attempts) },
              )
        }
      >
        {d.problem ??
          t(
            'components.inbox.detail-people.the_last_answer_was_nothing_new',
            'The last answer was {{value}}. Nothing new reaches it until it is fixed.',
            {
              value:
                d.lastResponse === null
                  ? t('components.inbox.detail-people.no_answer_at_all', 'no answer at all')
                  : `HTTP ${String(d.lastResponse)}`,
            },
          )}
      </Alert>
      <KeyValues
        items={[
          {
            label: t('components.inbox.detail-people.failing_since', 'Failing since'),
            value: when(d.since, zone),
          },
          {
            label: t('components.inbox.detail-people.waiting_to_send', 'Waiting to send'),
            value: String(d.waiting),
          },
          {
            label: t('components.inbox.detail-people.who_sees_this', 'Who sees this'),
            value: team.role,
          },
          ...(d.note === null
            ? []
            : [{ label: t('components.inbox.detail-people.note', 'Note'), value: `“${d.note}”` }]),
        ]}
      />
      <Actions
        hint={
          !taken
            ? t(
                'components.inbox.detail-people.taking_it_tells_the_other_admins',
                'Taking it tells the other admins you’re on it',
              )
            : team.mine
              ? t('components.inbox.detail-people.youre_on_it', 'You’re on it')
              : team.takenAt === null
                ? team.takenBy?.name == null
                  ? t('components.inbox.detail-people.somebody_took_it', 'Somebody took it')
                  : t('components.inbox.detail-people.name_took_it', '{{name}} took it', {
                      name: team.takenBy.name,
                    })
                : team.takenBy?.name == null
                  ? t(
                      'components.inbox.detail-people.somebody_took_it_at',
                      'Somebody took it at {{when}}',
                      {
                        when: when(team.takenAt, zone),
                      },
                    )
                  : t(
                      'components.inbox.detail-people.name_took_it_at',
                      '{{name}} took it at {{when}}',
                      {
                        name: team.takenBy.name,
                        when: when(team.takenAt, zone),
                      },
                    )
        }
      >
        {taken ? null : (
          <Button
            variant="primary"
            loading={act.pending}
            onClick={() => {
              act.run(() => takeTask(item.id, null), {
                title: t('components.inbox.detail-people.its_yours', 'It’s yours'),
                description: t(
                  'components.inbox.detail-people.it_stops_counting_for_the_other_admins',
                  'It stops counting for the other admins',
                ),
              });
            }}
          >
            {t('components.inbox.detail-people.take_it', 'Take it')}
          </Button>
        )}
        <OpenHere href={item.link}>
          {t('components.inbox.detail-people.open_in_integrations', 'Open in Integrations')}
        </OpenHere>
        {taken && !team.mine ? (
          <Button
            variant="ghost"
            onClick={() => {
              setOver(true);
            }}
          >
            {t('components.inbox.detail-people.take_it_over', 'Take it over')}
          </Button>
        ) : null}
      </Actions>
      {over ? (
        <NoteDialog
          title={t('components.inbox.detail-people.take_it_over_2', 'Take it over?')}
          description={t(
            'components.inbox.detail-people.sees_that_you_have_it_now',
            '{{value}} sees that you have it now.',
            {
              value:
                team.takenBy?.name ??
                t('components.inbox.detail-people.whoever_has_it', 'Whoever has it'),
            },
          )}
          label={t('components.inbox.detail-people.note', 'Note')}
          confirm={t('components.inbox.detail-people.take_it_over', 'Take it over')}
          optional
          onClose={() => {
            setOver(false);
          }}
          onConfirm={(note) => {
            setOver(false);
            act.run(() => takeTask(item.id, note === '' ? null : note), {
              title: t('components.inbox.detail-people.its_yours_now', 'It’s yours now'),
            });
          }}
        />
      ) : null}
    </div>
  );
}

/** Everything else People posts: the item, and where it lives. */
/** A pre-hire to set up: their record, filled in from the contract, where the invitation is sent. */
/**
 * A hire to set up: their record opens with the set-up dialog up, where HR
 * fills in their manager, department and the rest, and sends the invitation
 * now or on a day. The task goes once it is sent or scheduled.
 */
function SetUp({ item }: BodyProps): JSX.Element {
  const personId = item.id.replace(/^people:setup:/u, '');
  return (
    <div className="flex flex-col gap-3">
      {item.summary === null ? null : <p className="text-base text-fg-muted">{item.summary}</p>}
      <Actions>
        <OpenHere
          href={`/people/${personId}?invite=1`}
          variant="primary"
          startIcon={<icons.email aria-hidden />}
        >
          {t('components.inbox.detail-people.set_up_and_invite', 'Set up and invite')}
        </OpenHere>
      </Actions>
    </div>
  );
}

function Plain({ item }: BodyProps): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {item.summary === null ? null : <p className="text-base text-fg-muted">{item.summary}</p>}
      <Actions>
        <OpenHere href={item.link}>
          {t('components.inbox.detail-people.open_in', 'Open in {{openIn}}', {
            openIn: item.openIn,
          })}
        </OpenHere>
      </Actions>
    </div>
  );
}

function Missing(): JSX.Element {
  return (
    <Alert
      tone="warning"
      title={t(
        'components.inbox.detail-people.this_cant_be_shown_here',
        'This can’t be shown here',
      )}
    >
      {t(
        'components.inbox.detail-people.open_it_where_it_lives_instead',
        'Open it where it lives instead.',
      )}
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
    case 'people.setup':
      return <SetUp {...props} />;
    default:
      return <Plain {...props} />;
  }
}
