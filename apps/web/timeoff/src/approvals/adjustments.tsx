import {
  Alert,
  Avatar,
  Badge,
  Button,
  Combobox,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  List,
  ListItem,
  NumberField,
  PageHeader,
  PageSection,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { amount, shortDate } from '../words';
import { t as tr } from '../i18n';

/**
 * Balance adjustments (PRD §7.1): adding to or taking from someone's balance
 * by hand, always saying why. HR's counts at once; a manager's — anyone who
 * approves the person's time off — waits here for HR to approve or decline.
 * HR sees the queue and the last 30 days, a manager the ones they asked for.
 *
 * One component at every width: a row per adjustment, each form in a dialog.
 */

export interface AdjustmentsData {
  readonly hr: boolean;
  readonly items: readonly {
    readonly adjustmentId: string;
    readonly personId: string;
    readonly displayName: string;
    readonly leaveTypeName: string;
    readonly unit: 'day' | 'hour';
    readonly amount: string;
    readonly effectiveOn: string;
    readonly reason: string;
    readonly status: 'pending' | 'approved' | 'declined';
    readonly note: string | null;
    readonly canDecide: boolean;
  }[];
  /** Whom this person may adjust: the company for HR, their reports for a manager. */
  readonly people: readonly { readonly personId: string; readonly displayName: string }[];
  readonly leaveTypes: readonly {
    readonly key: string;
    readonly name: string;
    readonly unit: 'day' | 'hour';
  }[];
}

export interface AdjustmentsProps {
  readonly load: Loadable<AdjustmentsData>;
  readonly onAdjust?: (input: {
    readonly personId: string;
    readonly leaveTypeKey: string;
    readonly amount: string;
    readonly effectiveOn: string | null;
    readonly reason: string;
  }) => Promise<Outcome>;
  readonly onDecide?: (
    adjustmentId: string,
    approve: boolean,
    note: string | null,
  ) => Promise<Outcome>;
}

type Item = AdjustmentsData['items'][number];

const STATUS = {
  pending: { label: tr('approvals.adjustments.waiting_for_hr', 'Waiting for HR'), tone: 'warning' },
  approved: { label: tr('approvals.adjustments.counted', 'Counted'), tone: 'success' },
  declined: { label: tr('approvals.adjustments.declined', 'Declined'), tone: 'neutral' },
} as const;

const sized = (unit: 'day' | 'hour', value: string): string => {
  const n = amount(value.replace('-', ''));
  const sign = value.startsWith('-') ? '−' : '+';
  return unit === 'hour'
    ? `${sign}${n}h`
    : tr('approvals.adjustments.text', '{{sign}}{{n}} {{value}}', {
        sign,
        n,
        value: n === '1' ? 'day' : 'days',
      });
};

export function Adjustments(props: AdjustmentsProps): JSX.Element {
  const { load } = props;
  if (load.status === 'loading') return <AdjustmentsSkeleton />;
  return (
    <div className="flex flex-col gap-6">
      {load.status === 'error' ? (
        <PageHeader
          title={tr('approvals.adjustments.balance_adjustments', 'Balance adjustments')}
        />
      ) : null}
      <Loaded load={load} what="balance adjustments">
        {(data) => <Ready data={data} {...props} />}
      </Loaded>
    </div>
  );
}

function Ready({
  data,
  onAdjust,
  onDecide,
}: AdjustmentsProps & { readonly data: AdjustmentsData }): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [declining, setDeclining] = useState<Item | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const waiting = data.items.filter((i) => i.canDecide);
  const rest = data.items.filter((i) => !i.canDecide);
  const approve = (item: Item): void => {
    setRefused(null);
    void onDecide?.(item.adjustmentId, true, null).then((o) => {
      if (!o.ok) setRefused(o.message);
    });
  };
  const row = (item: Item, actions: boolean): JSX.Element => (
    <ListItem
      key={item.adjustmentId}
      leading={<Avatar name={item.displayName} />}
      description={[
        tr('approvals.adjustments.from', '{{leaveTypeName}} · from {{effectiveOn}}', {
          leaveTypeName: item.leaveTypeName,
          effectiveOn: shortDate(item.effectiveOn),
        }),
        `“${item.reason}”`,
        item.note,
      ]
        .filter(Boolean)
        .join(' · ')}
      trailing={
        actions ? (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setDeclining(item);
              }}
            >
              {tr('approvals.adjustments.decline', 'Decline')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                approve(item);
              }}
            >
              {tr('approvals.adjustments.approve', 'Approve')}
            </Button>
          </div>
        ) : (
          <Badge tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Badge>
        )
      }
    >
      {tr('approvals.adjustments.text_2', '{{displayName}} · {{sized}}', {
        displayName: item.displayName,
        sized: sized(item.unit, item.amount),
      })}
    </ListItem>
  );
  return (
    <>
      <PageHeader
        title={tr('approvals.adjustments.balance_adjustments', 'Balance adjustments')}
        description={
          data.hr
            ? `${String(waiting.length)} waiting for you; HR’s own count at once`
            : tr(
                'approvals.adjustments.days_you_asked_hr_to_add',
                'Days you asked HR to add or take away',
              )
        }
        actions={
          <Button
            variant="primary"
            startIcon={<icons.add aria-hidden />}
            onClick={() => {
              setAdding(true);
            }}
          >
            {tr('approvals.adjustments.adjust_a_balance', 'Adjust a balance')}
          </Button>
        }
      />
      {refused === null ? null : (
        <Alert tone="danger" title={tr('approvals.adjustments.not_decided', 'Not decided')}>
          {refused}
        </Alert>
      )}
      {waiting.length === 0 ? null : (
        <PageSection title={tr('approvals.adjustments.waiting_for_you', 'Waiting for you')}>
          <List aria-label={tr('approvals.adjustments.waiting_for_you', 'Waiting for you')}>
            {waiting.map((i) => row(i, true))}
          </List>
        </PageSection>
      )}
      <PageSection
        title={
          data.hr
            ? tr('approvals.adjustments.the_last_30_days', 'The last 30 days')
            : tr('approvals.adjustments.yours', 'Yours')
        }
      >
        {rest.length === 0 ? (
          <EmptyState
            title={tr('approvals.adjustments.nothing_adjusted_yet', 'Nothing adjusted yet')}
            description={tr(
              'approvals.adjustments.add_or_take_away_days_with',
              'Add or take away days with a reason; it shows beside them in the balance.',
            )}
          />
        ) : (
          <List
            aria-label={
              data.hr
                ? tr('approvals.adjustments.the_last_30_days', 'The last 30 days')
                : tr('approvals.adjustments.yours', 'Yours')
            }
          >
            {rest.map((i) => row(i, false))}
          </List>
        )}
      </PageSection>
      {adding && onAdjust !== undefined ? (
        <Adjust
          data={data}
          onAdjust={onAdjust}
          onClose={() => {
            setAdding(false);
          }}
        />
      ) : null}
      {declining === null || onDecide === undefined ? null : (
        <Decline
          item={declining}
          onDecide={onDecide}
          onClose={() => {
            setDeclining(null);
          }}
        />
      )}
    </>
  );
}

/** The form: who, what, how much, why and from when. */
function Adjust({
  data,
  onAdjust,
  onClose,
}: {
  readonly data: AdjustmentsData;
  readonly onAdjust: NonNullable<AdjustmentsProps['onAdjust']>;
  readonly onClose: () => void;
}): JSX.Element {
  const [personId, setPersonId] = useState<string | null>(null);
  const [leaveTypeKey, setLeaveTypeKey] = useState<string>(data.leaveTypes[0]?.key ?? '');
  const [direction, setDirection] = useState<'add' | 'take'>('add');
  const [size, setSize] = useState(1);
  const [reason, setReason] = useState('');
  const [on, setOn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const hours = data.leaveTypes.find((t) => t.key === leaveTypeKey)?.unit === 'hour';
  const ready = personId !== null && leaveTypeKey !== '' && size > 0 && reason.trim() !== '';
  const save = (): void => {
    if (personId === null) return;
    setBusy(true);
    setRefused(null);
    void onAdjust({
      personId,
      leaveTypeKey,
      amount: (direction === 'add' ? size : -size).toFixed(3),
      effectiveOn: on,
      reason: reason.trim(),
    }).then((outcome) => {
      setBusy(false);
      if (outcome.ok) onClose();
      else setRefused(outcome.message);
    });
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
            {tr('approvals.adjustments.adjust_a_balance', 'Adjust a balance')}
          </DialogTitle>
          <DialogDescription>
            {data.hr
              ? tr(
                  'approvals.adjustments.it_counts_as_soon_as_you',
                  'It counts as soon as you save it.',
                )
              : tr(
                  'approvals.adjustments.hr_approves_it_before_it_counts',
                  'HR approves it before it counts.',
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field required>
            <FieldLabel>{tr('approvals.adjustments.who', 'Who')}</FieldLabel>
            <FieldControl>
              <Combobox
                label={tr('approvals.adjustments.who', 'Who')}
                placeholder={tr('approvals.adjustments.choose_someone', 'Choose someone')}
                options={data.people.map((p) => ({
                  value: p.personId,
                  label: p.displayName,
                  icon: <Avatar name={p.displayName} size="xs" />,
                }))}
                value={personId}
                onChange={(value) => {
                  setPersonId(typeof value === 'string' ? value : null);
                }}
              />
            </FieldControl>
          </Field>
          <Field required>
            <FieldLabel>{tr('approvals.adjustments.leave_type', 'Leave type')}</FieldLabel>
            <Select value={leaveTypeKey} onValueChange={setLeaveTypeKey}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {data.leaveTypes.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex flex-wrap items-end gap-3">
            <SegmentedControl
              aria-label={tr('approvals.adjustments.add_or_take_away', 'Add or take away')}
              value={direction}
              onValueChange={(v) => {
                if (v !== '') setDirection(v === 'take' ? 'take' : 'add');
              }}
            >
              <SegmentedControlItem value="add">
                {tr('approvals.adjustments.add', 'Add')}
              </SegmentedControlItem>
              <SegmentedControlItem value="take">
                {tr('approvals.adjustments.take_away', 'Take away')}
              </SegmentedControlItem>
            </SegmentedControl>
            <NumberField
              label={
                hours
                  ? tr('approvals.adjustments.hours', 'Hours')
                  : tr('approvals.adjustments.days', 'Days')
              }
              value={size}
              min={0.5}
              max={365}
              step={0.5}
              onChange={(n) => {
                setSize(n ?? 0);
              }}
            />
          </div>
          <Field required>
            <FieldLabel>{tr('approvals.adjustments.why', 'Why')}</FieldLabel>
            <FieldControl>
              <Textarea
                value={reason}
                maxLength={500}
                placeholder={tr(
                  'approvals.adjustments.for_example_worked_the_offsite_weekend',
                  'For example, worked the offsite weekend',
                )}
                onChange={(e) => {
                  setReason(e.target.value);
                }}
              />
            </FieldControl>
            <FieldDescription>
              {tr(
                'approvals.adjustments.always_needed_they_see_it_beside',
                'Always needed. They see it beside the days.',
              )}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>{tr('approvals.adjustments.counts_from', 'Counts from')}</FieldLabel>
            <FieldControl>
              <DatePicker
                label={tr('approvals.adjustments.counts_from', 'Counts from')}
                placeholder={tr('approvals.adjustments.today', 'Today')}
                value={on}
                onChange={setOn}
              />
            </FieldControl>
          </Field>
          {refused === null ? null : (
            <Alert tone="danger" title={tr('approvals.adjustments.not_adjusted', 'Not adjusted')}>
              {refused}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{tr('approvals.adjustments.cancel', 'Cancel')}</Button>
          <Button
            variant="primary"
            startIcon={<icons.confirm aria-hidden />}
            disabled={!ready}
            loading={busy}
            loadingLabel={tr('approvals.adjustments.saving', 'Saving')}
            onClick={save}
          >
            {data.hr
              ? tr('approvals.adjustments.adjust', 'Adjust')
              : tr('approvals.adjustments.send_to_hr', 'Send to HR')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Declining, with a word for whoever asked. */
function Decline({
  item,
  onDecide,
  onClose,
}: {
  readonly item: Item;
  readonly onDecide: NonNullable<AdjustmentsProps['onDecide']>;
  readonly onClose: () => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
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
            {tr('approvals.adjustments.decline_for', 'Decline {{sized}} for {{displayName}}?', {
              sized: sized(item.unit, item.amount),
              displayName: item.displayName,
            })}
          </DialogTitle>
          <DialogDescription>{`“${item.reason}”`}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field>
            <FieldLabel>
              {tr('approvals.adjustments.why_not_optional', 'Why not (optional)')}
            </FieldLabel>
            <FieldControl>
              <Textarea
                value={note}
                maxLength={500}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          {refused === null ? null : (
            <Alert tone="danger" title={tr('approvals.adjustments.not_declined', 'Not declined')}>
              {refused}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{tr('approvals.adjustments.keep_it', 'Keep it')}</Button>
          <Button
            variant="danger"
            loading={busy}
            loadingLabel={tr('approvals.adjustments.declining', 'Declining')}
            onClick={() => {
              setBusy(true);
              void onDecide(item.adjustmentId, false, note.trim() === '' ? null : note.trim()).then(
                (o) => {
                  setBusy(false);
                  if (o.ok) onClose();
                  else setRefused(o.message);
                },
              );
            }}
          >
            {tr('approvals.adjustments.decline', 'Decline')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The tab while it loads. */
export function AdjustmentsSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('approvals.adjustments.balance_adjustments', 'Balance adjustments')}
        description={' '}
      />
      <div role="status" className="flex flex-col gap-2">
        <span className="sr-only">
          {tr('approvals.adjustments.loading_balance_adjustments', 'Loading balance adjustments')}
        </span>
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-16 rounded-sm" />
        ))}
      </div>
    </div>
  );
}
