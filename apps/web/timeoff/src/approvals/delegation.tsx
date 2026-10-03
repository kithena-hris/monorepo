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
  PageHeader,
  PageSection,
  Skeleton,
  icons,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { Loaded, type Loadable, type Outcome } from '../load';
import { firstName, spanLabel, type Range } from './words';

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

const DESCRIPTION = 'Who decides for you while you are away.';

export function Delegation({ load, onSave, onRemove }: DelegationProps): JSX.Element {
  if (load.status === 'loading') return <DelegationSkeleton />;
  return (
    <div className="@container/delegation flex flex-col gap-6">
      <PageHeader title="Requests" description={DESCRIPTION} />
      <Loaded load={load} what="your delegation">
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
  const name = delegate === undefined ? 'your delegate' : firstName(delegate.displayName);
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
      <PageSection title="While I’m away">
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel>Delegate</FieldLabel>
            <FieldControl>
              <Combobox
                label="Delegate"
                placeholder="Choose someone"
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
              <FieldLabel>From</FieldLabel>
              <FieldControl>
                <DatePicker label="From" value={from} onChange={setFrom} />
              </FieldControl>
            </Field>
            <Field invalid={rangeWrong}>
              <FieldLabel>To</FieldLabel>
              <FieldControl>
                <DatePicker label="To" value={to} onChange={setTo} />
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
            <FieldLabel>Set automatically whenever my time off is approved</FieldLabel>
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
            <FieldLabel>{`Let ${name} see salary-related requests`}</FieldLabel>
            <FieldDescription>Off by default. Overtime pay goes to HR instead.</FieldDescription>
          </Field>
          <Alert tone="info" title="Requests never get stuck">
            {`If neither of you decides in 3 working days, it goes to ${data.escalatesTo?.displayName ?? 'HR'}.`}
          </Alert>
          {said === null ? null : (
            <Alert
              tone={said.ok ? 'success' : 'danger'}
              title={said.ok ? said.text : 'Nothing changed'}
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
                  'Saved',
                );
              }}
            >
              Save
            </Button>
            {now === null ? null : (
              <Button
                variant="ghost"
                disabled={onRemove === undefined || pending}
                onClick={() => {
                  if (onRemove !== undefined) run(() => onRemove(data.approverId), 'Removed');
                }}
              >
                Remove delegate
              </Button>
            )}
          </div>
        </div>
      </PageSection>
      <PageSection title="You cover for">
        {data.coveringFor.length === 0 ? (
          <p className="text-sm text-fg-muted">Nobody has asked you to decide for them.</p>
        ) : (
          <List>
            {data.coveringFor.map((c) => (
              <ListItem
                key={c.approverId}
                leading={<Avatar name={c.approverName} />}
                description={
                  c.automatic
                    ? 'Whenever their time off is approved'
                    : c.range === null
                      ? 'Until they say otherwise'
                      : spanLabel(c.range.from, c.range.to)
                }
                trailing={
                  <Badge size="sm" tone="info">
                    <icons.approve aria-hidden />
                    Delegate
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
      <PageHeader title="Requests" description={DESCRIPTION} />
      <div role="status" className={body}>
        <span className="sr-only">Loading your delegation</span>
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
