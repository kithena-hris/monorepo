import {
  Alert,
  Avatar,
  Badge,
  Button,
  Checkbox,
  Combobox,
  DatePicker,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  List,
  ListItem,
  PageSection,
  Skeleton,
  icons,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { firstName, spanLabel, type Range } from './words';
import { t } from '../i18n';
import { Header } from '../frame';

/**
 * Delegating approvals (T19, §9.7): who decides for me while I am away, for
 * a range of dates or whenever my own time off is approved, and whether they
 * see salary-related requests (off by default; overtime pay goes to HR
 * instead). Beside it, whom I cover for. Nothing waits longer than three
 * working days: then it goes to my manager.
 */

export interface DelegationData {
  /** The caller, whose delegate this is. */
  readonly approverId: string;
  readonly escalatesTo: { readonly personId: string; readonly displayName: string } | null;
  readonly delegation: {
    readonly delegateId: string;
    readonly delegateName: string;
    readonly range: Range | null;
    readonly automatic: boolean;
    readonly salaryRelated: boolean;
  } | null;
  readonly candidates: readonly { readonly personId: string; readonly displayName: string }[];
  readonly coveringFor: readonly {
    readonly approverId: string;
    readonly approverName: string;
    readonly range: Range | null;
    readonly automatic: boolean;
  }[];
}

export interface DelegationChoice {
  readonly delegateId: string;
  readonly range: Range | null;
  readonly automatic: boolean;
  readonly salaryRelated: boolean;
}

export interface DelegationProps {
  readonly load: Loadable<DelegationData>;
  readonly onSave?: (approverId: string, choice: DelegationChoice) => Promise<Outcome>;
  readonly onRemove?: (approverId: string) => Promise<Outcome>;
}

const DESCRIPTION = (): string =>
  t(
    'approvals.delegation.who_decides_for_you_while_you_are',
    'Who decides for you while you are away.',
  );

export function Delegation({ load, onSave, onRemove }: DelegationProps): JSX.Element {
  if (load.status === 'loading') return <DelegationSkeleton />;
  return (
    <div className="@container/delegation flex flex-col gap-6">
      <Header
        title={t('approvals.delegation.delegate_approvals', 'Delegate approvals')}
        description={DESCRIPTION()}
      />
      <Loaded load={load} what={t('approvals.delegation.your_delegation', 'your delegation')}>
        {(data) => (
          <Ready
            key={data.delegation?.delegateId ?? 'none'}
            data={data}
            onSave={onSave}
            onRemove={onRemove}
          />
        )}
      </Loaded>
    </div>
  );
}

const body =
  'flex flex-col gap-5 @min-[56rem]/delegation:grid @min-[56rem]/delegation:grid-cols-2 @min-[56rem]/delegation:items-start';

function Ready({
  data,
  onSave,
  onRemove,
}: {
  readonly data: DelegationData;
  readonly onSave: DelegationProps['onSave'];
  readonly onRemove: DelegationProps['onRemove'];
}): JSX.Element {
  const now = data.delegation;
  const [delegateId, setDelegateId] = useState<string | null>(now?.delegateId ?? null);
  const [from, setFrom] = useState<string | null>(now?.range?.from ?? null);
  const [to, setTo] = useState<string | null>(now?.range?.to ?? null);
  const [automatic, setAutomatic] = useState(now?.automatic ?? true);
  const [salaryRelated, setSalaryRelated] = useState(now?.salaryRelated ?? false);
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const delegate = data.candidates.find((c) => c.personId === delegateId);
  const name =
    delegate === undefined
      ? t('approvals.delegation.your_delegate', 'your delegate')
      : firstName(delegate.displayName);
  const rangeWrong =
    (from === null) !== (to === null) || (from !== null && to !== null && to < from);
  const run = (action: () => Promise<Outcome>, done: string): void => {
    setSaid(null);
    start(async () => {
      const outcome = await action();
      setSaid(outcome.ok ? { ok: true, text: done } : { ok: false, text: outcome.message });
    });
  };
  return (
    <div className={body}>
      <PageSection title={t('approvals.delegation.while_im_away', 'While I’m away')}>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel>{t('approvals.delegation.delegate', 'Delegate')}</FieldLabel>
            <FieldControl>
              <Combobox
                label={t('approvals.delegation.delegate', 'Delegate')}
                placeholder={t('approvals.delegation.choose_someone', 'Choose someone')}
                options={data.candidates.map((c) => ({
                  value: c.personId,
                  label: c.displayName,
                  icon: <Avatar name={c.displayName} size="xs" />,
                }))}
                value={delegateId}
                onChange={(value) => {
                  setDelegateId(typeof value === 'string' ? value : null);
                }}
              />
            </FieldControl>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field invalid={rangeWrong}>
              <FieldLabel>{t('approvals.delegation.from', 'From')}</FieldLabel>
              <FieldControl>
                <DatePicker
                  label={t('approvals.delegation.from', 'From')}
                  value={from}
                  onChange={setFrom}
                />
              </FieldControl>
            </Field>
            <Field invalid={rangeWrong}>
              <FieldLabel>{t('approvals.delegation.to', 'To')}</FieldLabel>
              <FieldControl>
                <DatePicker
                  label={t('approvals.delegation.to', 'To')}
                  value={to}
                  onChange={setTo}
                />
              </FieldControl>
            </Field>
          </div>
          <Field orientation="horizontal" className="justify-start">
            <FieldControl>
              <Checkbox
                checked={automatic}
                onCheckedChange={(on) => {
                  setAutomatic(on === true);
                }}
              />
            </FieldControl>
            <FieldLabel>
              {t(
                'approvals.delegation.set_automatically_whenever_my_time_off',
                'Set automatically whenever my time off is approved',
              )}
            </FieldLabel>
          </Field>
          <Field orientation="horizontal" className="items-start justify-start">
            <FieldControl>
              <Checkbox
                checked={salaryRelated}
                onCheckedChange={(on) => {
                  setSalaryRelated(on === true);
                }}
              />
            </FieldControl>
            <FieldLabel>
              {t(
                'approvals.delegation.let_see_salary_related_requests',
                'Let {{name}} see salary-related requests',
                { name },
              )}
            </FieldLabel>
            <FieldDescription>
              {t(
                'approvals.delegation.off_by_default_overtime_pay_goes',
                'Off by default. Overtime pay goes to HR instead.',
              )}
            </FieldDescription>
          </Field>
          <Alert
            tone="info"
            title={t('approvals.delegation.requests_never_get_stuck', 'Requests never get stuck')}
          >
            {data.escalatesTo?.displayName == null
              ? t(
                  'approvals.delegation.if_neither_decides_goes_to_hr',
                  'If neither of you decides in 3 working days, it goes to HR.',
                )
              : t(
                  'approvals.delegation.if_neither_of_you_decides_in',
                  'If neither of you decides in 3 working days, it goes to {{value}}.',
                  { value: data.escalatesTo.displayName },
                )}
          </Alert>
          {said === null ? null : (
            <Alert
              tone={said.ok ? 'success' : 'danger'}
              title={
                said.ok ? said.text : t('approvals.delegation.nothing_changed', 'Nothing changed')
              }
            >
              {said.ok ? undefined : said.text}
            </Alert>
          )}
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={onSave === undefined || pending || delegateId === null || rangeWrong}
              loading={pending}
              onClick={() => {
                if (onSave === undefined || delegateId === null) return;
                run(
                  () =>
                    onSave(data.approverId, {
                      delegateId,
                      range: from === null || to === null ? null : { from, to },
                      automatic,
                      salaryRelated,
                    }),
                  t('approvals.delegation.saved', 'Saved'),
                );
              }}
            >
              {t('approvals.delegation.save', 'Save')}
            </Button>
            {now === null ? null : (
              <Button
                variant="ghost"
                disabled={onRemove === undefined || pending}
                onClick={() => {
                  if (onRemove !== undefined)
                    run(
                      () => onRemove(data.approverId),
                      t('approvals.delegation.removed', 'Removed'),
                    );
                }}
              >
                {t('approvals.delegation.remove_delegate', 'Remove delegate')}
              </Button>
            )}
          </div>
        </div>
      </PageSection>
      <PageSection title={t('approvals.delegation.you_cover_for', 'You cover for')}>
        {data.coveringFor.length === 0 ? (
          <p className="text-sm text-fg-muted">
            {t(
              'approvals.delegation.nobody_has_asked_you_to_decide',
              'Nobody has asked you to decide for them.',
            )}
          </p>
        ) : (
          <List>
            {data.coveringFor.map((c) => (
              <ListItem
                key={c.approverId}
                leading={<Avatar name={c.approverName} />}
                description={
                  c.automatic
                    ? t(
                        'approvals.delegation.whenever_their_time_off_is_approved',
                        'Whenever their time off is approved',
                      )
                    : c.range === null
                      ? t(
                          'approvals.delegation.until_they_say_otherwise',
                          'Until they say otherwise',
                        )
                      : spanLabel(c.range.from, c.range.to)
                }
                trailing={
                  <Badge size="sm" tone="info">
                    <icons.approve aria-hidden />
                    {t('approvals.delegation.delegate', 'Delegate')}
                  </Badge>
                }
              >
                {c.approverName}
              </ListItem>
            ))}
          </List>
        )}
      </PageSection>
    </div>
  );
}

/** Delegation while it loads: the form's fields and the list beside it, in place. */
export function DelegationSkeleton(): JSX.Element {
  return (
    <div className="@container/delegation flex flex-col gap-6">
      <Header
        title={t('approvals.delegation.delegate_approvals', 'Delegate approvals')}
        description={DESCRIPTION()}
      />
      <div role="status" className={body}>
        <span className="sr-only">
          {t('approvals.delegation.loading_your_delegation', 'Loading your delegation')}
        </span>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-16 rounded-md" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-16 rounded-md" />
            <Skeleton className="h-16 rounded-md" />
          </div>
          <Skeleton className="h-5 w-80" />
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-20 rounded-md" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
