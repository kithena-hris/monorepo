import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Inline,
  List,
  ListItem,
  RadioDot,
  Stack,
  Text,
  Textarea,
} from '@reach/ui-native';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { Failed, Loading, Page } from '../../frame';
import { useAct } from '../act';
import { useRead } from '../api';
import { longDate } from '../display';
import type { PeopleScreen } from '../routes';
import type { DuplicatesState, MergedPair } from './model';
import { t } from '../../i18n';

/**
 * Two records that may be one person (design E4): the two stacked, the one
 * that survives chosen (People says which may, and why not), the values to
 * take across ticked, then Merge — always HR's decision, and additive: the
 * other becomes a tombstone and both histories stay. "Not the same" takes
 * the pair out of the queue for good.
 */
export function ReviewDuplicate({
  navigation,
  route,
}: PeopleScreen<'ReviewDuplicate'>): React.JSX.Element {
  const { a, b } = route.params;
  const { load, reload } = useRead<DuplicatesState>('Duplicates', { a, b });
  const { act, busy } = useAct();
  const [keep, setKeep] = useState<string | null>(null);
  const [take, setTake] = useState<readonly string[]>([]);
  const back = {
    label: t('people.review.duplicate.all_items', 'All items'),
    onPress: navigation.goBack,
  };

  if (load.status === 'loading')
    return (
      <Page back={back}>
        <Loading
          label={t('people.review.duplicate.loading_both_records', 'Loading both records')}
        />
      </Page>
    );
  if (load.status === 'error')
    return (
      <Page back={back}>
        <Failed message={load.message} onRetry={reload} />
      </Page>
    );
  const comparison = load.data.comparison;
  const pair = load.data.items.find((p) => p.personIds.includes(a) && p.personIds.includes(b));
  if (comparison === null) {
    return (
      <Page back={back}>
        <Alert tone="info" title={t('people.review.duplicate.already_decided', 'Already decided')}>
          {t(
            'people.review.duplicate.these_two_are_no_longer_waiting',
            'These two are no longer waiting.',
          )}
        </Alert>
      </Page>
    );
  }
  const [first, second] = comparison.people;
  if (first === undefined || second === undefined) return <Page back={back}>{null}</Page>;
  // The first that may survive is chosen to start with.
  const survivor = keep ?? (first.refusal === null ? first.id : second.id);
  const absorbed = survivor === first.id ? second : first;
  const sideOf = (id: string): number => comparison.people.findIndex((p) => p.id === id);

  return (
    <Page
      title={first.name}
      back={back}
      foot={
        <>
          <Button
            className="flex-1"
            fullWidth
            loading={busy === 'DismissDuplicate'}
            onPress={() => {
              void act(
                'DismissDuplicate',
                { personIds: [a, b] },
                t('people.review.duplicate.not_the_same_person', 'Not the same person'),
              ).then((done) => {
                if (done !== null) navigation.goBack();
              });
            }}
          >
            {t('people.review.duplicate.not_the_same', 'Not the same')}
          </Button>
          <Button
            className="flex-1"
            fullWidth
            variant="primary"
            loading={busy === 'MergePerson'}
            disabled={comparison.people.find((p) => p.id === survivor)?.refusal != null}
            onPress={() => {
              void act(
                'MergePerson',
                { personId: survivor, absorbedPersonId: absorbed.id, take },
                'Merged',
              ).then((done) => {
                if (done !== null) navigation.goBack();
              });
            }}
          >
            {t('people.review.duplicate.merge', 'Merge')}
          </Button>
        </>
      }
    >
      <Text tone="muted">
        {t(
          'people.review.duplicate.a_sealed_value_shows_its_last',
          '{{value}}{{value2}}. A sealed value shows its last four.',
          {
            value: pair?.reasons.join(', ') ?? 'They look alike',
            value2:
              pair?.match == null
                ? ''
                : ` · ${pair.match === 'strong' ? 'Strong' : pair.match === 'likely' ? 'Likely' : 'Possible'} match`,
          },
        )}
      </Text>
      {comparison.people.map((person) => {
        const side = sideOf(person.id);
        const chosen = person.id === survivor;
        return (
          <Card key={person.id} className={chosen ? 'border-2 border-accent' : undefined}>
            <Stack gap={2}>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: chosen, disabled: person.refusal !== null }}
                disabled={person.refusal !== null}
                onPress={() => {
                  setKeep(person.id);
                  setTake([]);
                }}
              >
                <Inline gap={2} wrap={false}>
                  <RadioDot checked={chosen} disabled={person.refusal !== null} />
                  <Text weight="semibold">
                    {t('people.review.duplicate.keep_s_record', 'Keep {{name}}’s record', {
                      name: person.name,
                    })}
                  </Text>
                  <Badge size="sm">{person.status}</Badge>
                </Inline>
              </Pressable>
              {person.refusal === null ? null : (
                <Text variant="footnote" tone="muted">
                  {person.refusal}
                </Text>
              )}
              {comparison.rows.map((row) => {
                // On the record that goes, a value it could give the survivor is a tick box.
                const takeable = !chosen && !row.same && row.takeable[side] === true;
                return (
                  <Inline key={row.key} gap={2} wrap={false} className="min-h-9">
                    <Text variant="subhead" tone="muted" className="w-24">
                      {row.label}
                    </Text>
                    <Text weight="medium" className="flex-1">
                      {row.values[side] ?? '—'}
                    </Text>
                    {takeable ? (
                      <Checkbox
                        checked={take.includes(row.key)}
                        accessibilityLabel={t(
                          'people.review.duplicate.take_from',
                          'Take {{label}} from {{name}}',
                          { label: row.label, name: person.name },
                        )}
                        onCheckedChange={(on) => {
                          setTake((held) =>
                            on ? [...held, row.key] : held.filter((k) => k !== row.key),
                          );
                        }}
                      />
                    ) : null}
                  </Inline>
                );
              })}
            </Stack>
          </Card>
        );
      })}
    </Page>
  );
}

/** Undoing a merge: a reason, and what goes back and what stays because it changed since. */
function Unmerge({
  merge,
  onClose,
  onDone,
}: {
  merge: MergedPair;
  onClose: () => void;
  onDone: () => void;
}) {
  const { act, busy } = useAct();
  const [reason, setReason] = useState('');
  const [shown, setShown] = useState(false);
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
            {t('people.review.duplicate.undo_merging', 'Undo merging {{absorbedName}}', {
              absorbedName: merge.absorbedName,
            })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'people.review.duplicate.s_record_comes_back_as_it',
              '{{absorbedName}}’s record comes back as it was.{{value}}{{value2}}{{value3}}',
              {
                absorbedName: merge.absorbedName,
                value:
                  merge.reversed.length === 0 ? '' : ` Copied back: ${merge.reversed.join(', ')}.`,
                value2:
                  merge.kept.length === 0
                    ? ''
                    : ` Kept on ${merge.survivorName}, changed since: ${merge.kept.join(', ')}.`,
                value3: merge.account === null ? '' : ` Sign-in: ${merge.account}.`,
              },
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field required invalid={shown && reason.trim() === ''}>
            <FieldLabel>{t('people.review.duplicate.why', 'Why')}</FieldLabel>
            <Textarea value={reason} onChange={setReason} maxLength={500} />
            {shown && reason.trim() === '' ? (
              <FieldError>{t('people.review.duplicate.say_why', 'Say why.')}</FieldError>
            ) : null}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('people.review.duplicate.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant="danger"
            loading={busy !== null}
            onPress={() => {
              setShown(true);
              if (reason.trim() === '') return;
              void act(
                'UnmergePerson',
                { personId: merge.absorbedId, reason: reason.trim() },
                t('people.review.duplicate.merge_undone', 'Merge undone'),
              ).then((done) => {
                if (done === null) return;
                onClose();
                onDone();
              });
            }}
          >
            {t('people.review.duplicate.undo_merge', 'Undo merge')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Merges still standing, each with Undo merge where People allows it. */
export function Merges({
  merges,
  onDone,
}: {
  merges: readonly MergedPair[];
  onDone: () => void;
}): React.JSX.Element {
  const [undoing, setUndoing] = useState<MergedPair | null>(null);
  return (
    <Stack gap={2}>
      <Text variant="footnote" weight="semibold" tone="muted" className="px-1">
        {t('people.review.duplicate.merged_records', 'Merged records')}
      </Text>
      <List>
        {merges.map((m) => (
          <ListItem
            key={m.absorbedId}
            description={t(
              'people.review.duplicate.into',
              'Into {{survivorName}} · {{longDate}}{{value}}',
              {
                survivorName: m.survivorName,
                longDate: longDate(m.mergedAt.slice(0, 10)),
                value: m.refusal === null ? '' : ` · ${m.refusal}`,
              },
            )}
            {...(m.refusal === null
              ? {
                  trailing: (
                    <Button
                      size="xs"
                      onPress={() => {
                        setUndoing(m);
                      }}
                    >
                      {t('people.review.duplicate.undo', 'Undo')}
                    </Button>
                  ),
                }
              : {})}
          >
            {m.absorbedName}
          </ListItem>
        ))}
      </List>
      {undoing === null ? null : (
        <Unmerge
          merge={undoing}
          onClose={() => {
            setUndoing(null);
          }}
          onDone={onDone}
        />
      )}
    </Stack>
  );
}
