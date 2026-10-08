import {
  AssistantMark,
  Badge,
  Button,
  Card,
  Chip,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  FilterBuilder,
  Input,
  isConditionComplete,
  List,
  ListItem,
  RadioGroup,
  RadioGroupItem,
  Stack,
  Text,
  type FilterGroup,
} from '@reach/ui-native';
import * as SecureStore from 'expo-secure-store';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useAct } from './act';
import { ask, type Signed } from './api';
import { describeCondition, filterFields, type Condition, type DirectoryField } from './filters';
import { parsed } from './review/load';

/** One reading of an ambiguous phrase, as the whole selection it would be. */
export interface Reading {
  readonly label: string;
  readonly conditions: readonly Condition[];
  readonly match: 'all' | 'any';
  readonly count: number | null;
}

export interface Refusal {
  readonly text: string;
  readonly why: string;
  readonly instead: {
    readonly label: string;
    readonly subject: string;
    readonly condition: Condition;
    readonly count: number | null;
  } | null;
}

/** What People made of a sentence typed in the Directory (`peopleDirectoryPlan`). */
export interface Plan {
  readonly search: string | null;
  readonly conditions: readonly Condition[];
  readonly match: 'all' | 'any';
  readonly sort: string | null;
  readonly top: number | null;
  readonly group: string | null;
  readonly notes: readonly string[];
  readonly unused: readonly string[];
  readonly by: 'search' | 'assistant' | 'rules';
  readonly note: string | null;
  readonly person: { readonly id: string; readonly name: string } | null;
  readonly ask: {
    readonly topic: string | null;
    readonly phrase: string;
    readonly readings: readonly Reading[];
  } | null;
  readonly refused: readonly Refusal[];
  readonly remembered: {
    readonly topic: string;
    readonly phrase: string;
    readonly label: string;
  } | null;
}

/*
 * The readings chosen before ("I'll remember it for next time"), topic to
 * label, on this phone only, as the web keeps them in its browser. Missing,
 * and the question is asked back again.
 */
const READINGS = 'kithena.readings';

async function remembered(): Promise<Record<string, string>> {
  try {
    const saved: unknown = JSON.parse((await SecureStore.getItemAsync(READINGS)) ?? '{}');
    return typeof saved === 'object' && saved !== null ? (saved as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function rememberReading(topic: string, label: string): Promise<void> {
  await SecureStore.setItemAsync(
    READINGS,
    JSON.stringify({ ...(await remembered()), [topic]: label }),
  ).catch(() => undefined);
}

/** A sentence as the Directory's own filters and order. A read: nothing changes. */
export async function planOf(
  signed: Signed,
  sentence: string,
): Promise<{ ok: true; plan: Plan } | { ok: false; message: string }> {
  const chosen = await remembered();
  const answer = await ask<string>(signed, 'DirectoryPlan', {
    sentence,
    remembered: Object.keys(chosen).length === 0 ? null : JSON.stringify(chosen),
  });
  if (!answer.ok) return answer;
  const plan = parsed(answer.data) as Plan | null;
  return plan === null ? { ok: false, message: 'People did not answer.' } : { ok: true, plan };
}

/** A card the assistant speaks in: its mark, then a title. */
function AskCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Card>
      <Stack gap={3}>
        <View className="flex-row items-center gap-2">
          <AssistantMark size={20} />
          <Text variant="headline" className="flex-1">
            {title}
          </Text>
        </View>
        {children}
      </Stack>
    </Card>
  );
}

const people = (n: number): string => `${String(n)} ${n === 1 ? 'person' : 'people'}`;

/**
 * Everything a question needs from the person before it is searched (C2):
 * the parts left out and why, with a field that records something close
 * offered and never applied; and a phrase read more than one way, its
 * readings as full-width choices with counts.
 */
export function NeedsYou({
  refused,
  asked,
  onPick,
  onUse,
  onRemove,
}: {
  refused: readonly Refusal[];
  asked: Plan['ask'];
  onPick: (reading: Reading) => void;
  onUse: (refusal: Refusal) => void;
  onRemove: (refusal: Refusal) => void;
}): React.JSX.Element | null {
  return (
    <>
      {refused.length === 0 ? null : (
        <AskCard
          title={
            refused.length === 1
              ? 'One part I couldn’t use'
              : `${String(refused.length)} parts I couldn’t use`
          }
        >
          {refused.map((r) => (
            <Stack key={r.text} gap={2}>
              <View className="flex-row">
                <Chip variant="dashed">{r.text}</Chip>
              </View>
              <Text variant="subhead" tone="muted">
                {`${r.why} ${
                  r.instead === null
                    ? 'I left it out.'
                    : `I can search the ${r.instead.label} field for “${r.instead.subject}” instead${
                        r.instead.count === null
                          ? '.'
                          : `, which ${people(r.instead.count)} ${r.instead.count === 1 ? 'has' : 'have'} listed.`
                      }`
                }`}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {r.instead === null ? null : (
                  <Button
                    size="sm"
                    variant="primary"
                    onPress={() => {
                      onUse(r);
                    }}
                  >
                    {`Use the ${r.instead.label} field`}
                  </Button>
                )}
                <Button
                  size="sm"
                  onPress={() => {
                    onRemove(r);
                  }}
                >
                  Remove it
                </Button>
              </View>
            </Stack>
          ))}
        </AskCard>
      )}
      {asked === null || asked.readings.length === 0 ? null : (
        <AskCard title={`What does “${asked.phrase}” mean here?`}>
          {/* Rows rather than buttons: a reading is a sentence, and a button holds one line. */}
          <List>
            {asked.readings.map((r) => (
              <ListItem
                key={r.label}
                {...(r.count === null
                  ? { chevron: true }
                  : { trailing: <Badge size="sm">{String(r.count)}</Badge> })}
                onPress={() => {
                  onPick(r);
                }}
              >
                {r.label}
              </ListItem>
            ))}
          </List>
          <Text variant="footnote" tone="muted">
            Pick one and I’ll remember it for next time.
          </Text>
        </AskCard>
      )}
    </>
  );
}

/**
 * The conditions in force as chips that remove themselves: "Understood as"
 * after a question, its unused words dashed and what was not understood
 * said; plain chips otherwise. Every chip is one of the Directory's own
 * filters, so nothing narrows the list unseen.
 */
export function Conditions({
  fields,
  conditions,
  understood,
  unused,
  notes,
  onRemove,
  onDropUnused,
  onEdit,
  onSave,
}: {
  fields: readonly DirectoryField[];
  conditions: readonly Condition[];
  understood: boolean;
  unused: readonly string[];
  notes: readonly string[];
  onRemove: (index: number) => void;
  onDropUnused: (text: string) => void;
  onEdit: () => void;
  /** Save as view: offered while there are conditions to keep. */
  onSave?: () => void;
}): React.JSX.Element | null {
  if (!understood && conditions.length === 0) return null;
  return (
    <Stack gap={2}>
      <View className="flex-row items-center gap-2">
        {understood ? <AssistantMark size={16} /> : null}
        <Text variant="footnote" weight="semibold" tone="muted" className="flex-1">
          {understood ? 'Understood as' : 'Filtered by'}
        </Text>
        {onSave === undefined ? null : (
          <Button variant="link" size="sm" onPress={onSave}>
            Save as view
          </Button>
        )}
        <Button variant="link" size="sm" onPress={onEdit}>
          {understood ? 'Edit as filters' : 'Edit'}
        </Button>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {conditions.map((c, i) => {
          const text = describeCondition(fields, c);
          return (
            <Chip
              key={`${c.key}:${String(i)}`}
              selected
              removeLabel={`Remove ${text}`}
              onRemove={() => {
                onRemove(i);
              }}
            >
              {text}
            </Chip>
          );
        })}
        {unused.map((u) => (
          <Chip
            key={`unused:${u}`}
            variant="dashed"
            removeLabel={`Remove “${u}”, which was not used`}
            onRemove={() => {
              onDropUnused(u);
            }}
          >
            {`“${u}”`}
          </Chip>
        ))}
      </View>
      {notes.map((n) => (
        <Text key={n} variant="footnote" tone="muted">
          {n}
        </Text>
      ))}
    </Stack>
  );
}

/**
 * Filter people (C3): centred, like the desktop. Each opening starts from
 * what is in force, with one empty row when nothing is; nothing applies
 * until Apply.
 */
export function FiltersDialog({
  fields,
  conditions,
  match,
  onApply,
  onClose,
}: {
  fields: readonly DirectoryField[];
  conditions: readonly Condition[];
  match: 'all' | 'any';
  onApply: (conditions: readonly Condition[], match: 'all' | 'any') => void;
  onClose: () => void;
}): React.JSX.Element {
  const builderFields = filterFields(fields);
  const first = builderFields[0];
  const [draft, setDraft] = useState<FilterGroup>(() => ({
    match,
    conditions:
      conditions.length > 0
        ? conditions.map((c, i) => ({
            id: `c${String(i)}`,
            field: c.key,
            operator: c.op,
            values: c.values,
          }))
        : first === undefined
          ? []
          : [{ id: 'first', field: first.id, operator: first.operators[0]?.id ?? '', values: [] }],
  }));
  const complete = draft.conditions.filter((c) => isConditionComplete(builderFields, c));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Filter people</DialogTitle>
          <DialogDescription>Nothing applies until you press Apply.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ScrollView style={{ flexGrow: 0, maxHeight: 420 }}>
            <FilterBuilder
              label="Conditions"
              fields={builderFields}
              value={draft}
              onChange={setDraft}
              maxConditions={20}
            />
          </ScrollView>
        </DialogBody>
        <DialogFooter>
          <Button
            className="flex-1"
            onPress={() => {
              setDraft({ match: 'all', conditions: [] });
            }}
          >
            Clear
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            onPress={() => {
              onApply(
                complete.map((c) => ({ key: c.field, op: c.operator, values: c.values })),
                draft.match,
              );
              onClose();
            }}
          >
            {complete.length === 0 ? 'Show all' : `Apply ${String(complete.length)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Save the conditions in force as a view of one's own, or the company's. */
export function SaveViewDialog({
  conditions,
  match,
  onSaved,
  onClose,
}: {
  conditions: readonly Condition[];
  match: 'all' | 'any';
  onSaved: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { act, busy } = useAct();
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save this view</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Field required>
            <FieldLabel>Name</FieldLabel>
            <Input value={name} onChange={setName} maxLength={80} size="sm" />
          </Field>
          <RadioGroup
            accessibilityLabel="Who can use it"
            value={shared ? 'company' : 'me'}
            onValueChange={(next) => {
              setShared(next === 'company');
            }}
          >
            <RadioGroupItem value="me">Only me</RadioGroupItem>
            <RadioGroupItem
              value="company"
              description="Others see only the people and fields they can already see."
            >
              Share with the company
            </RadioGroupItem>
          </RadioGroup>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            disabled={name.trim() === ''}
            loading={busy === 'SaveSegment'}
            onPress={() => {
              void act<{ id: string }>(
                'SaveSegment',
                {
                  name: name.trim(),
                  shared,
                  filter: [],
                  conditions: conditions.map((c) => ({
                    key: c.key,
                    op: c.op,
                    values: [...c.values],
                  })),
                  match,
                },
                'View saved',
              ).then((saved) => {
                if (saved !== null) onSaved(saved.id);
              });
            }}
          >
            Save view
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
