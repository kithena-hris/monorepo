import {
  Button,
  Chip,
  DatePicker,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
} from '@reach/ui-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

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
  const [from, setFrom] = useState<string | null>(null);
  const [until, setUntil] = useState<string | null>(null);
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
  const ready = d !== null && from !== null && until !== null && to !== undefined;
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
          <DialogDescription>People waiting see who has their request.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {d?.delegation?.range != null ? (
            <Text variant="footnote" tone="muted">
              {`${d.delegation.delegateName} has them from ${d.delegation.range.from} to ${d.delegation.range.to}.`}
            </Text>
          ) : null}
          <Field>
            <FieldLabel>Who</FieldLabel>
            <Select value={to ?? ''} onValueChange={setTo}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue placeholder="Choose someone" />
                </SelectTrigger>
              </FieldControl>
              <SelectContent title="Who">
                {(d?.candidates ?? []).map((c) => (
                  <SelectItem key={c.personId} value={c.personId}>
                    {c.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <View className="flex-row gap-2.5">
            <View className="flex-1">
              <Field>
                <FieldLabel>From</FieldLabel>
                <DatePicker label="From" value={from} onChange={setFrom} />
              </Field>
            </View>
            <View className="flex-1">
              <Field>
                <FieldLabel>Until</FieldLabel>
                <DatePicker label="Until" value={until} onChange={setUntil} />
              </Field>
            </View>
          </View>
          <Field>
            <FieldLabel>What</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              <Chip selected disabled>
                Time off
              </Chip>
            </View>
            <FieldDescription>Review in People stays with HR.</FieldDescription>
          </Field>
        </DialogBody>
        <DialogFooter>
          {d?.delegation == null ? (
            <Button className="flex-1" onPress={onClose}>
              Cancel
            </Button>
          ) : (
            <Button
              className="flex-1"
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
            className="flex-1"
            variant="primary"
            disabled={!ready}
            loading={busy === 'SetTimeOffDelegation'}
            onPress={() => {
              if (!ready) return;
              void act(
                'SetTimeOffDelegation',
                {
                  approverId: d.approverId,
                  input: { delegateId: to, range: { from, to: until } },
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
