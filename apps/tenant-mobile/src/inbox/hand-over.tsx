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
import { t } from '../i18n';

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
          <DialogTitle>
            {t('inbox.hand-over.hand_over_while_youre_away', 'Hand over while you’re away')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'inbox.hand-over.people_waiting_see_who_has_their',
              'People waiting see who has their request.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {d?.delegation?.range != null ? (
            <Text variant="footnote" tone="muted">
              {t(
                'inbox.hand-over.has_them_from_to',
                '{{delegateName}} has them from {{from}} to {{to}}.',
                {
                  delegateName: d.delegation.delegateName,
                  from: d.delegation.range.from,
                  to: d.delegation.range.to,
                },
              )}
            </Text>
          ) : null}
          <Field>
            <FieldLabel>{t('inbox.hand-over.who', 'Who')}</FieldLabel>
            <Select value={to ?? ''} onValueChange={setTo}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t('inbox.hand-over.choose_someone', 'Choose someone')}
                  />
                </SelectTrigger>
              </FieldControl>
              <SelectContent title={t('inbox.hand-over.who', 'Who')}>
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
                <FieldLabel>{t('inbox.hand-over.from', 'From')}</FieldLabel>
                <DatePicker
                  label={t('inbox.hand-over.from', 'From')}
                  value={from}
                  onChange={setFrom}
                />
              </Field>
            </View>
            <View className="flex-1">
              <Field>
                <FieldLabel>{t('inbox.hand-over.until', 'Until')}</FieldLabel>
                <DatePicker
                  label={t('inbox.hand-over.until', 'Until')}
                  value={until}
                  onChange={setUntil}
                />
              </Field>
            </View>
          </View>
          <Field>
            <FieldLabel>{t('inbox.hand-over.what', 'What')}</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              <Chip selected disabled>
                {t('inbox.hand-over.time_off', 'Time off')}
              </Chip>
            </View>
            <FieldDescription>
              {t(
                'inbox.hand-over.review_in_people_stays_with_hr',
                'Review in People stays with HR.',
              )}
            </FieldDescription>
          </Field>
        </DialogBody>
        <DialogFooter>
          {d?.delegation == null ? (
            <Button className="flex-1" onPress={onClose}>
              {t('inbox.hand-over.cancel', 'Cancel')}
            </Button>
          ) : (
            <Button
              className="flex-1"
              loading={busy === 'RemoveTimeOffDelegation'}
              onPress={() => {
                void act(
                  'RemoveTimeOffDelegation',
                  { approverId: d.approverId },
                  t('inbox.hand-over.handed_back', 'Handed back'),
                ).then(onClose);
              }}
            >
              {t('inbox.hand-over.stop', 'Stop')}
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
                t('inbox.hand-over.handed_over', 'Handed over'),
              ).then((done) => {
                if (done !== null) onClose();
              });
            }}
          >
            {t('inbox.hand-over.hand_over', 'Hand over')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
