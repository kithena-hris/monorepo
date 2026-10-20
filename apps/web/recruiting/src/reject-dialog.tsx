import {
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
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { Refusal, useAct, words } from './shared';
import type { ScreenProps } from './types';

export interface Rejecting {
  readonly ids: readonly string[];
  readonly names: readonly string[];
}

/** What a rejection needs from the screen it is on: the job's name, the company's reasons and emails, its pools. */
export interface RejectOptions {
  readonly jobTitle: string;
  readonly rejectionReasons: readonly string[];
  readonly templates: readonly {
    readonly id: string;
    readonly name: string;
    readonly purpose: string;
  }[];
  readonly pools: readonly { readonly id: string; readonly name: string }[];
}

/** PRD §12.4: a reason from the company's list, an email or none, a send time, and a pool to keep them in. */
export function RejectDialog({
  options: data,
  rejecting,
  onClose,
  props,
}: {
  readonly options: RejectOptions;
  readonly rejecting: Rejecting | null;
  readonly onClose: () => void;
  readonly props: Pick<ScreenProps<unknown>, 'onAct' | 'onRefresh'>;
}): JSX.Element {
  const act = useAct(props);
  const [reason, setReason] = useState(data.rejectionReasons[0] ?? 'not_qualified');
  const [template, setTemplate] = useState<string>(
    data.templates.find((t) => t.purpose === 'rejection')?.id ?? 'none',
  );
  const [send, setSend] = useState<'now' | 'later_today' | 'none'>('later_today');
  const [pool, setPool] = useState<string>('none');
  const many = (rejecting?.ids.length ?? 0) > 1;
  const submit = (): void => {
    if (rejecting === null) return;
    const templateId = template === 'none' ? null : template;
    if (many) {
      act.run(
        'BulkApplications',
        {
          input: {
            action: 'reject',
            ids: rejecting.ids,
            reasonKey: reason,
            templateId,
            send: templateId === null ? 'none' : send,
          },
        },
        onClose,
      );
    } else {
      act.run(
        'RejectApplication',
        {
          applicationId: rejecting.ids[0],
          input: {
            reasonKey: reason,
            templateId,
            send: templateId === null ? 'none' : send,
            poolId: pool === 'none' ? null : pool,
          },
        },
        onClose,
      );
    }
  };
  return (
    <Dialog
      open={rejecting !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {many
              ? `Reject ${String(rejecting?.ids.length ?? 0)} candidates`
              : `Reject ${rejecting?.names[0] ?? ''}`}
          </DialogTitle>
          <DialogDescription>{`${data.jobTitle}${many ? ` · ${rejecting?.names.join(', ') ?? ''}` : ''}`}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Refusal error={act.error} />
          <Field required>
            <FieldLabel>Reason</FieldLabel>
            <Select value={reason} onValueChange={setReason}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {data.rejectionReasons.map((r) => (
                  <SelectItem key={r} value={r}>
                    {words(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Internal. The email never states a reason the candidate hasn’t seen in writing.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Email</FieldLabel>
            <Select value={template} onValueChange={setTemplate}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                <SelectItem value="none">No email</SelectItem>
                {data.templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {template === 'none' ? null : (
            <Field>
              <FieldLabel>Send</FieldLabel>
              <SegmentedControl
                value={send}
                onValueChange={(v) => {
                  setSend(v as typeof send);
                }}
              >
                <SegmentedControlItem value="now">Now</SegmentedControlItem>
                <SegmentedControlItem value="later_today">Later today</SegmentedControlItem>
              </SegmentedControl>
              <FieldDescription>
                Later today: a few hours on, and never between 21:00 and 08:00 in the candidate’s
                time zone.
              </FieldDescription>
            </Field>
          )}
          {many || data.pools.length === 0 ? null : (
            <Field>
              <FieldLabel>Add to a talent pool</FieldLabel>
              <Select value={pool} onValueChange={setPool}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  <SelectItem value="none">Not now</SelectItem>
                  {data.pools.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Without pool consent the candidate is asked by email first.
              </FieldDescription>
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={act.pending} onClick={submit}>
            {many ? `Reject ${String(rejecting?.ids.length ?? 0)}` : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
