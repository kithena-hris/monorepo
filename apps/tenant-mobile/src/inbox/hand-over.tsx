import {
  Button,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem,
  Text,
} from '@reach/ui-native';
import { useEffect, useState } from 'react';

import { useAct } from '../people/act';
import { read, useSigned } from '../people/api';

/**
 * Hand over while away (M:F3, G4): Time Off's cover for the approver's dates.
 * People waiting see who has their request; Review stays with HR.
 */

interface Delegation {
  readonly approverId: string;
  readonly candidates: readonly { readonly personId: string; readonly displayName: string }[];
  readonly delegation: {
    readonly delegateName: string;
    readonly range: { readonly from: string; readonly to: string } | null;
  } | null;
}

export function HandOver({ onClose }: { onClose: () => void }): React.JSX.Element {
  const signed = useSigned();
  const { act, busy } = useAct('timeoff');
  const [d, setD] = useState<Delegation | null>(null);
  const [range, setRange] = useState<{ start: string | null; end: string | null } | null>(null);
  const [to, setTo] = useState<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void read<Delegation>(signed, 'TimeOffDelegation', {}, 'timeoff').then((a) => {
      if (live && a.ok) setD(a.data);
    });
    return () => {
      live = false;
    };
  }, [signed]);
  const ready = d !== null && range?.start != null && range.end != null && to !== undefined;
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hand over while you’re away</DialogTitle>
          <DialogDescription>
            Approvals go to someone else for these dates. People waiting see who has them.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {d?.delegation?.range != null ? (
            <Text variant="footnote" tone="muted">
              {`${d.delegation.delegateName} has them from ${d.delegation.range.from} to ${d.delegation.range.to}.`}
            </Text>
          ) : null}
          <DatePicker mode="range" label="From – Until" value={range} onChange={setRange} />
          <RadioGroup value={to} onValueChange={setTo}>
            {(d?.candidates ?? []).map((c) => (
              <RadioGroupItem key={c.personId} value={c.personId}>
                {c.displayName}
              </RadioGroupItem>
            ))}
          </RadioGroup>
        </DialogBody>
        <DialogFooter>
          {d?.delegation == null ? (
            <Button onPress={onClose}>Cancel</Button>
          ) : (
            <Button
              loading={busy === 'RemoveTimeOffDelegation'}
              onPress={() => {
                void act(
                  'RemoveTimeOffDelegation',
                  { approverId: d.approverId },
                  'Handed back',
                ).then(onClose);
              }}
            >
              Stop
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!ready}
            loading={busy === 'SetTimeOffDelegation'}
            onPress={() => {
              if (!ready) return;
              void act(
                'SetTimeOffDelegation',
                {
                  approverId: d.approverId,
                  input: { delegateId: to, range: { from: range.start, to: range.end } },
                },
                'Handed over',
              ).then((done) => {
                if (done !== null) onClose();
              });
            }}
          >
            Hand over
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
