import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChangeDiff,
  ChipRow,
  Chip,
  EmptyState,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  KeyValues,
  NumberField,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  DataTable,
  type DataColumn,
  Textarea,
  icons,
  DatePicker,
} from '@reach/ui';
import { useMemo, useState, type JSX } from 'react';

import { Loaded } from './load';
import { Refusal, StateBadge, To, newId, range, useAct, words } from './shared';
import type { Requisition, ScreenProps } from './types';
import { t } from './i18n';

/**
 * R2, R2b, R3, requisitions (design R2–R3): the list with where each
 * approval stands, the editor, and the approval an approver opens from the
 * Inbox, with what changed since an earlier approval.
 */

const STATES = ['all', 'draft', 'pending_approval', 'approved', 'filled', 'rejected'] as const;
const REASONS = ['new_role', 'backfill', 'temporary_cover', 'growth'] as const;

type RequisitionRow = Requisition;
const idOf = (r: RequisitionRow): string => r.id;
const titleOf = (r: RequisitionRow): string => r.title;

/** R2's columns: where each requisition stands, and what it asks for. */
function requisitionColumns(
  onNavigate: ScreenProps<unknown>['onNavigate'],
): readonly DataColumn<RequisitionRow>[] {
  return [
    {
      id: 'title',
      header: t('requisitions.title', 'Title'),
      sortBy: (r) => r.title,
      cell: (r) => (
        <To
          href={
            r.approval?.mine === true
              ? `/recruiting/requisitions/${r.id}/approve`
              : `/recruiting/requisitions/${r.id}`
          }
          onNavigate={onNavigate}
        >
          {r.title}
        </To>
      ),
    },
    {
      id: 'manager',
      header: t('requisitions.hiring_manager', 'Hiring manager'),
      sortBy: (r) => r.hiringManager ?? '',
      cell: (r) => r.hiringManager ?? '—',
    },
    {
      id: 'reason',
      header: t('requisitions.reason', 'Reason'),
      hideOnCard: true,
      sortBy: (r) => r.reason,
      cell: (r) => <span className="text-sm text-fg-muted">{words(r.reason)}</span>,
    },
    {
      id: 'openings',
      header: t('requisitions.openings', 'Openings'),
      numeric: true,
      sortBy: (r) => r.openings,
      cell: (r) =>
        t('requisitions.of', '{{filled}} of {{openings}}', {
          filled: String(r.filled),
          openings: String(r.openings),
        }),
    },
    {
      id: 'budget',
      header: t('requisitions.budget', 'Budget'),
      hideOnCard: true,
      sortBy: (r) => r.budget?.to.amountMinor ?? 0,
      cell: (r) =>
        r.budget === null
          ? '—'
          : range(r.budget.from.amountMinor, r.budget.to.amountMinor, r.budget.to.currency),
    },
    {
      id: 'state',
      header: t('requisitions.state', 'State'),
      cardTrailing: true,
      sortBy: (r) => r.state,
      cell: (r) => (
        <span className="flex flex-col gap-1">
          <StateBadge state={r.state} />
          {r.approval == null ? null : (
            <span className="text-xs text-fg-muted">
              {t('requisitions.step_of', 'Step {{step}} of {{steps}}', {
                step: String(r.approval.step),
                steps: String(r.approval.steps),
              })}
            </span>
          )}
        </span>
      ),
    },
  ];
}

export function Requisitions(props: ScreenProps<readonly Requisition[]>): JSX.Element {
  const state = props.search?.['state'] ?? 'all';
  const { onNavigate } = props;
  const columns = useMemo(() => requisitionColumns(onNavigate), [onNavigate]);
  return (
    <Loaded load={props.load} what="requisitions">
      {(all) => {
        const rows = state === 'all' ? all : all.filter((r) => r.state === state);
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={t('requisitions.requisitions', 'Requisitions')}
              description={t(
                'requisitions.requests_for_headcount_an_approved_requisition',
                'Requests for headcount. An approved requisition opens one or more jobs; one job can fill openings from several.',
              )}
              actions={
                <Button
                  startIcon={<icons.add aria-hidden />}
                  onClick={() => props.onNavigate?.('/recruiting/requisitions/new')}
                >
                  {t('requisitions.new_requisition', 'New requisition')}
                </Button>
              }
            />
            <ChipRow aria-label={t('requisitions.state', 'State')}>
              {STATES.map((s) => (
                <Chip
                  key={s}
                  selected={state === s}
                  onClick={() => props.onFilter?.({ state: s === 'all' ? null : s })}
                >
                  {s === 'all' ? t('requisitions.all', 'All') : words(s)}
                </Chip>
              ))}
            </ChipRow>
            {rows.length === 0 ? (
              <EmptyState
                icon={<icons.work aria-hidden />}
                title={t('requisitions.no_requisitions_here', 'No requisitions here')}
              />
            ) : (
              <DataTable<RequisitionRow>
                label={t('requisitions.requisitions', 'Requisitions')}
                rows={rows}
                rowId={idOf}
                describeRow={titleOf}
                fill
                columns={columns}
              />
            )}
          </div>
        );
      }}
    </Loaded>
  );
}

const blank = (id: string): Requisition => ({
  id,
  title: '',
  orgUnitId: null,
  hiringManagerId: null,
  legalEntityId: null,
  locationIds: [],
  openings: 1,
  filled: 0,
  targetStart: null,
  reason: 'new_role',
  replacesPersonId: null,
  budget: null,
  justification: '',
  state: 'draft',
});

/** R2b: draft or edit; sending asks the approval chain the company's rules choose. */
export function RequisitionEditor(props: ScreenProps<readonly Requisition[]>): JSX.Element {
  const id = props.params?.['id'] ?? 'new';
  const act = useAct(props);
  return (
    <Loaded load={props.load} what="the requisition">
      {(all) => (
        <Editor
          initial={all.find((r) => r.id === id) ?? blank(id === 'new' ? newId() : id)}
          isNew={id === 'new'}
          act={act}
          props={props}
        />
      )}
    </Loaded>
  );
}

function Editor({
  initial,
  isNew,
  act,
  props,
}: {
  readonly initial: Requisition;
  readonly isNew: boolean;
  readonly act: ReturnType<typeof useAct>;
  readonly props: ScreenProps<readonly Requisition[]>;
}): JSX.Element {
  const [r, setR] = useState(initial);
  const [currency, setCurrency] = useState(initial.budget?.to.currency ?? 'EUR');
  const [from, setFrom] = useState<number | null>(
    initial.budget === null ? null : initial.budget.from.amountMinor / 100,
  );
  const [to, setTo] = useState<number | null>(
    initial.budget === null ? null : initial.budget.to.amountMinor / 100,
  );
  const editable = r.state === 'draft' || r.state === 'approved' || r.state === 'pending_approval';
  const value = (): Requisition => ({
    ...r,
    budget:
      from === null || to === null
        ? null
        : {
            from: { amountMinor: Math.round(from * 100), currency },
            to: { amountMinor: Math.round(to * 100), currency },
          },
  });
  const save = (after?: () => void): void => {
    const { approval: _a, hiringManager: _h, ...input } = value();
    act.run('SaveRequisition', { requisitionId: r.id, input }, () => {
      if (isNew) props.onNavigate?.(`/recruiting/requisitions/${r.id}`);
      after?.();
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={isNew ? t('requisitions.new_requisition', 'New requisition') : r.title}
        meta={<StateBadge state={r.state} />}
        actions={
          <>
            {r.state === 'draft' && !isNew ? (
              <Button
                variant="secondary"
                onClick={() => {
                  act.run('CancelRequisition', { requisitionId: r.id });
                }}
              >
                {t('requisitions.cancel_requisition', 'Cancel requisition')}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              disabled={!editable}
              loading={act.pending}
              onClick={() => {
                save();
              }}
            >
              {t('requisitions.save', 'Save')}
            </Button>
            {r.state === 'draft' && !isNew ? (
              <Button
                loading={act.pending}
                onClick={() => {
                  save(() => {
                    act.run('SubmitRequisition', { requisitionId: r.id });
                  });
                }}
              >
                {t('requisitions.send_for_approval', 'Send for approval')}
              </Button>
            ) : null}
          </>
        }
      />
      <Refusal error={act.error} />
      {r.state === 'approved' ? (
        <Alert tone="info" title={t('requisitions.approved', 'Approved')}>
          {t(
            'requisitions.changing_the_openings_or_the_budget',
            'Changing the openings or the budget sends it back for approval, with the difference.',
          )}
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle level={2}>{t('requisitions.the_request', 'The request')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field required>
              <FieldLabel>{t('requisitions.title', 'Title')}</FieldLabel>
              <FieldControl>
                <Input
                  value={r.title}
                  onChange={(e) => {
                    setR({ ...r, title: e.target.value });
                  }}
                />
              </FieldControl>
            </Field>
            <NumberField
              label={t('requisitions.openings', 'Openings')}
              value={r.openings}
              min={1}
              max={500}
              onChange={(n) => {
                setR({ ...r, openings: n ?? 1 });
              }}
            />
            <Field>
              <FieldLabel>{t('requisitions.reason', 'Reason')}</FieldLabel>
              <Select
                value={r.reason}
                onValueChange={(v) => {
                  setR({ ...r, reason: v as Requisition['reason'] });
                }}
              >
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  {REASONS.map((x) => (
                    <SelectItem key={x} value={x}>
                      {words(x)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>{t('requisitions.target_start', 'Target start')}</FieldLabel>
              <FieldControl>
                <DatePicker
                  label={t('requisitions.target_start', 'Target start')}
                  value={r.targetStart}
                  onChange={(d) => {
                    setR({ ...r, targetStart: d });
                  }}
                />
              </FieldControl>
            </Field>
            {r.reason === 'backfill' ? (
              <Field required>
                <FieldLabel>
                  {t('requisitions.replacing_person_id', 'Replacing (person id)')}
                </FieldLabel>
                <FieldControl>
                  <Input
                    value={r.replacesPersonId ?? ''}
                    onChange={(e) => {
                      setR({
                        ...r,
                        replacesPersonId: e.target.value === '' ? null : e.target.value,
                      });
                    }}
                  />
                </FieldControl>
              </Field>
            ) : null}
            <Field>
              <FieldLabel>{t('requisitions.currency', 'Currency')}</FieldLabel>
              <FieldControl>
                <Input
                  value={currency}
                  maxLength={3}
                  onChange={(e) => {
                    setCurrency(e.target.value.toUpperCase());
                  }}
                />
              </FieldControl>
              <FieldDescription>
                {t('requisitions.the_legal_entitys_currency', 'The legal entity’s currency.')}
              </FieldDescription>
            </Field>
            <NumberField
              label={t('requisitions.budget_from_yearly', 'Budget from (yearly)')}
              value={from}
              min={0}
              onChange={setFrom}
            />
            <NumberField
              label={t('requisitions.budget_to_yearly', 'Budget to (yearly)')}
              value={to}
              min={0}
              onChange={setTo}
            />
            <Field className="md:col-span-2">
              <FieldLabel>{t('requisitions.justification', 'Justification')}</FieldLabel>
              <FieldControl>
                <Textarea
                  rows={3}
                  value={r.justification}
                  onChange={(e) => {
                    setR({ ...r, justification: e.target.value });
                  }}
                />
              </FieldControl>
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle level={2}>{t('requisitions.approval', 'Approval')}</CardTitle>
            <CardDescription>
              {t(
                'requisitions.the_chain_is_chosen_by_the',
                'The chain is chosen by the company’s rules: budget, reason, entity.',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {r.approval == null ? (
              <p className="text-sm text-fg-muted">
                {r.state === 'draft'
                  ? t(
                      'requisitions.nobody_is_asked_until_you_send',
                      'Nobody is asked until you send it.',
                    )
                  : t('requisitions.no_approval_waiting', 'No approval waiting.')}
              </p>
            ) : (
              <KeyValues
                items={[
                  {
                    label: t('requisitions.step', 'Step'),
                    value: `${String(r.approval.step)} of ${String(r.approval.steps)}`,
                  },
                  {
                    label: t('requisitions.waiting_on', 'Waiting on'),
                    value: r.approval.waitingOn.filter(Boolean).join(', ') || '—',
                  },
                ]}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** R3: the approver's view, with what changed since an earlier approval. */
export function RequisitionApproval(props: ScreenProps<readonly Requisition[]>): JSX.Element {
  const id = props.params?.['id'] ?? '';
  const act = useAct(props);
  const [comment, setComment] = useState('');
  return (
    <Loaded load={props.load} what="the approval">
      {(all) => {
        const r = all.find((x) => x.id === id);
        if (r === undefined || r.approval == null) {
          return (
            <EmptyState
              icon={<icons.approve aria-hidden />}
              title={t('requisitions.nothing_to_approve_here', 'Nothing to approve here')}
              description={t(
                'requisitions.it_may_already_be_decided',
                'It may already be decided.',
              )}
            />
          );
        }
        return (
          <div className="flex flex-col gap-4">
            <PageHeader
              title={t('requisitions.approve_requisition', 'Approve requisition: {{title}}', {
                title: r.title,
              })}
              description={t(
                'requisitions.asked_by_step_of',
                'Asked by {{value}} · step {{step}} of {{steps}}',
                {
                  value: r.hiringManager ?? 'the hiring manager',
                  step: String(r.approval.step),
                  steps: String(r.approval.steps),
                },
              )}
              meta={<Badge tone="warning">{t('requisitions.waiting', 'Waiting')}</Badge>}
            />
            <Refusal error={act.error} />
            {r.approval.changes.length > 0 ? (
              <Alert
                tone="warning"
                title={t('requisitions.changed_after_approval', 'Changed after approval')}
              >
                <ChangeDiff
                  items={r.approval.changes.map((c) => ({
                    label: words(c.field),
                    before: c.from,
                    after: c.to,
                  }))}
                />
              </Alert>
            ) : null}
            <Card>
              <CardContent>
                <KeyValues
                  layout="aligned"
                  items={[
                    { label: t('requisitions.openings', 'Openings'), value: String(r.openings) },
                    { label: t('requisitions.reason', 'Reason'), value: words(r.reason) },
                    {
                      label: t('requisitions.budget', 'Budget'),
                      value:
                        r.budget === null
                          ? '—'
                          : range(
                              r.budget.from.amountMinor,
                              r.budget.to.amountMinor,
                              r.budget.to.currency,
                            ),
                    },
                    {
                      label: t('requisitions.target_start', 'Target start'),
                      value: r.targetStart ?? '—',
                    },
                    {
                      label: t('requisitions.justification', 'Justification'),
                      value: r.justification || '—',
                    },
                  ]}
                />
              </CardContent>
            </Card>
            {r.approval.mine ? (
              <Card padded>
                <div className="flex flex-col gap-3">
                  <Field>
                    <FieldLabel>{t('requisitions.comment', 'Comment')}</FieldLabel>
                    <FieldControl>
                      <Textarea
                        rows={2}
                        placeholder={t(
                          'requisitions.optional_required_to_reject',
                          'Optional. Required to reject.',
                        )}
                        value={comment}
                        onChange={(e) => {
                          setComment(e.target.value);
                        }}
                      />
                    </FieldControl>
                  </Field>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="secondary"
                      loading={act.pending}
                      onClick={() => {
                        act.run('DecideRequisition', {
                          requisitionId: r.id,
                          input: { decision: 'rejected', comment },
                        });
                      }}
                    >
                      {t('requisitions.reject', 'Reject')}
                    </Button>
                    <Button
                      loading={act.pending}
                      onClick={() => {
                        act.run(
                          'DecideRequisition',
                          {
                            requisitionId: r.id,
                            input: {
                              decision: 'approved',
                              comment: comment === '' ? null : comment,
                            },
                          },
                          () => props.onNavigate?.('/recruiting/requisitions'),
                        );
                      }}
                    >
                      {t('requisitions.approve', 'Approve')}
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <Alert tone="neutral" title={t('requisitions.not_your_step', 'Not your step')}>
                {t('requisitions.waiting_on_2', 'Waiting on {{join}}.', {
                  join: r.approval.waitingOn.filter(Boolean).join(', '),
                })}
              </Alert>
            )}
          </div>
        );
      }}
    </Loaded>
  );
}
