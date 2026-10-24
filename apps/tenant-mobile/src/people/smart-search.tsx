import {
  AssistantMark,
  Badge,
  Button,
  Card,
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
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useAct } from './act';
import { ask, useSigned, type Signed } from './api';
import { describeCondition, filterFields, type Condition, type DirectoryField } from './filters';
import { parsed } from './review/load';
import { t } from '../i18n';

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
  return plan === null
    ? {
        ok: false,
        message: t('people.smart-search.people_did_not_answer', 'People did not answer.'),
      }
    : { ok: true, plan };
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

const people = (n: number): string =>
  t(
    'people.smart-search.people',
    { one: '{{count}} person', other: '{{count}} people' },
    { count: n },
  );

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
              ? t('people.smart-search.one_part_i_couldnt_use', 'One part I couldn’t use')
              : t('people.smart-search.parts_i_couldnt_use', '{{String}} parts I couldn’t use', {
                  String: String(refused.length),
                })
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
                    ? t('people.smart-search.i_left_it_out', 'I left it out.')
                    : t(
                        'people.smart-search.i_can_search_the_field_for',
                        'I can search the {{label}} field for “{{subject}}” instead{{value}}',
                        {
                          label: r.instead.label,
                          subject: r.instead.subject,
                          value:
                            r.instead.count === null
                              ? '.'
                              : `, which ${people(r.instead.count)} ${r.instead.count === 1 ? 'has' : 'have'} listed.`,
                        },
                      )
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
                    {t('people.smart-search.use_the_field', 'Use the {{label}} field', {
                      label: r.instead.label,
                    })}
                  </Button>
                )}
                <Button
                  size="sm"
                  onPress={() => {
                    onRemove(r);
                  }}
                >
                  {t('people.smart-search.remove_it', 'Remove it')}
                </Button>
              </View>
            </Stack>
          ))}
        </AskCard>
      )}
      {asked === null || asked.readings.length === 0 ? null : (
        <AskCard
          title={t('people.smart-search.what_does_mean_here', 'What does “{{phrase}}” mean here?', {
            phrase: asked.phrase,
          })}
        >
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
            {t(
              'people.smart-search.pick_one_and_ill_remember_it',
              'Pick one and I’ll remember it for next time.',
            )}
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
          {understood
            ? t('people.smart-search.understood_as', 'Understood as')
            : t('people.smart-search.filtered_by', 'Filtered by')}
        </Text>
        {onSave === undefined ? null : (
          <Button variant="link" size="sm" onPress={onSave}>
            {t('people.smart-search.save_as_view', 'Save as view')}
          </Button>
        )}
        <Button variant="link" size="sm" onPress={onEdit}>
          {understood
            ? t('people.smart-search.edit_as_filters', 'Edit as filters')
            : t('people.smart-search.edit', 'Edit')}
        </Button>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {conditions.map((c, i) => {
          const text = describeCondition(fields, c);
          return (
            <Chip
              key={`${c.key}:${String(i)}`}
              selected
              removeLabel={t('people.smart-search.remove', 'Remove {{text}}', { text })}
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
            removeLabel={t(
              'people.smart-search.remove_which_was_not_used',
              'Remove “{{u}}”, which was not used',
              { u },
            )}
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
          <DialogTitle>{t('people.smart-search.filter_people', 'Filter people')}</DialogTitle>
          <DialogDescription>
            {t(
              'people.smart-search.nothing_applies_until_you_press_apply',
              'Nothing applies until you press Apply.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ScrollView style={{ flexGrow: 0, maxHeight: 420 }}>
            <FilterBuilder
              label={t('people.smart-search.conditions', 'Conditions')}
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
            {t('people.smart-search.clear', 'Clear')}
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
            {complete.length === 0
              ? t('people.smart-search.show_all', 'Show all')
              : t('people.smart-search.apply', 'Apply {{String}}', {
                  String: String(complete.length),
                })}
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
          <DialogTitle>{t('people.smart-search.save_this_view', 'Save this view')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Field required>
            <FieldLabel>{t('people.smart-search.name', 'Name')}</FieldLabel>
            <Input value={name} onChange={setName} maxLength={80} size="sm" />
          </Field>
          <RadioGroup
            accessibilityLabel={t('people.smart-search.who_can_use_it', 'Who can use it')}
            value={shared ? 'company' : 'me'}
            onValueChange={(next) => {
              setShared(next === 'company');
            }}
          >
            <RadioGroupItem value="me">
              {t('people.smart-search.only_me', 'Only me')}
            </RadioGroupItem>
            <RadioGroupItem
              value="company"
              description={t(
                'people.smart-search.others_see_only_the_people_and',
                'Others see only the people and fields they can already see.',
              )}
            >
              {t('people.smart-search.share_with_the_company', 'Share with the company')}
            </RadioGroupItem>
          </RadioGroup>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {t('people.smart-search.cancel', 'Cancel')}
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
                t('people.smart-search.view_saved', 'View saved'),
              ).then((saved) => {
                if (saved !== null) onSaved(saved.id);
              });
            }}
          >
            {t('people.smart-search.save_view', 'Save view')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The fields Filters offers as chips: a few choices each, and a start date as a range. */
function chipFields(fields: readonly DirectoryField[]): {
  readonly chips: readonly DirectoryField[];
  readonly date: DirectoryField | null;
} {
  return {
    chips: fields
      .filter(
        (f) =>
          (f.kind === 'select' || f.kind === 'status') &&
          f.options.length > 0 &&
          f.options.length <= 12,
      )
      .slice(0, 3),
    date:
      fields.find((f) => f.kind === 'date' && /hire|start/u.test(f.key)) ??
      fields.find((f) => f.kind === 'date') ??
      null,
  };
}

/**
 * Filter people (design v3 P5): chips with live counts, centred, and a
 * button that says how many people it leaves. Anything a chip cannot say
 * is under More conditions, the full builder.
 */
export function ChipFiltersDialog({
  fields,
  conditions,
  onApply,
  onMore,
  onClose,
}: {
  fields: readonly DirectoryField[];
  conditions: readonly Condition[];
  onApply: (conditions: readonly Condition[]) => void;
  onMore: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const signed = useSigned();
  const { chips, date } = chipFields(fields);
  const [picked, setPicked] = useState<Readonly<Record<string, readonly string[]>>>(() =>
    Object.fromEntries(conditions.filter((c) => c.op === 'in').map((c) => [c.key, c.values])),
  );
  const held = conditions.find((c) => date !== null && c.key === date.key && c.op === 'between');
  const [range, setRange] = useState<{ start: string | null; end: string | null } | null>(
    held === undefined ? null : { start: held.values[0] ?? null, end: held.values[1] ?? null },
  );
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({});
  const [total, setTotal] = useState<number | null>(null);

  const chosen = (without?: string): Condition[] => [
    ...Object.entries(picked)
      .filter(([key, values]) => key !== without && values.length > 0)
      .map(([key, values]) => ({ key, op: 'in', values })),
    ...(date !== null && range !== null && (range.start !== null || range.end !== null)
      ? [{ key: date.key, op: 'between', values: [range.start ?? '', range.end ?? ''] }]
      : []),
  ];

  // How many each chip would leave, beside what else is chosen, and the total.
  // ponytail: one Directory read per chip (a dozen at most); a facet count in People if it grows.
  const key = JSON.stringify([picked, range]);
  useEffect(() => {
    let live = true;
    const count = (cs: readonly Condition[]) =>
      ask<{ total: number }>(signed, 'Directory', {
        conditions: cs.length === 0 ? null : cs,
        top: null,
      }).then((a) => (a.ok ? a.data.total : null));
    void count(chosen()).then((n) => {
      if (live) setTotal(n);
    });
    void Promise.all(
      chips.flatMap((f) =>
        f.options.map(async (o) => {
          const n = await count([...chosen(f.key), { key: f.key, op: 'in', values: [o.value] }]);
          return [`${f.key}:${o.value}`, n] as [string, number | null];
        }),
      ),
    ).then((pairs) => {
      if (live)
        setCounts(
          Object.fromEntries(pairs.flatMap(([k, n]) => (n === null ? [] : [[k, n] as const]))),
        );
    });
    return () => {
      live = false;
    };
  }, [key, signed]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('people.smart-search.filter_people', 'Filter people')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <ScrollView style={{ flexGrow: 0, maxHeight: 460 }} contentContainerClassName="gap-4">
            {chips.map((f) => (
              <View key={f.key} className="gap-2">
                <Text variant="subhead" weight="semibold" tone="muted">
                  {f.label}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {f.options.map((o) => {
                    const on = (picked[f.key] ?? []).includes(o.value);
                    const n = counts[`${f.key}:${o.value}`];
                    return (
                      <Chip
                        key={o.value}
                        selected={on}
                        onPress={() => {
                          setPicked((was) => {
                            const values = was[f.key] ?? [];
                            return {
                              ...was,
                              [f.key]: on
                                ? values.filter((v) => v !== o.value)
                                : [...values, o.value],
                            };
                          });
                        }}
                      >
                        {n === undefined ? o.label : `${o.label} ${String(n)}`}
                      </Chip>
                    );
                  })}
                </View>
              </View>
            ))}
            {date === null ? null : (
              <Field>
                <FieldLabel>
                  {t('people.smart-search.between', '{{label}} between', { label: date.label })}
                </FieldLabel>
                <DatePicker mode="range" label={date.label} value={range} onChange={setRange} />
              </Field>
            )}
            <Button variant="link" onPress={onMore}>
              {t('people.smart-search.more_conditions', 'More conditions')}
            </Button>
          </ScrollView>
        </DialogBody>
        <DialogFooter>
          <Button
            className="flex-1"
            onPress={() => {
              setPicked({});
              setRange(null);
            }}
          >
            {t('people.smart-search.clear', 'Clear')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            onPress={() => {
              onApply(chosen());
              onClose();
            }}
          >
            {total === null
              ? t('people.smart-search.show_people', 'Show people')
              : t('people.smart-search.show', 'Show {{people}}', { people: people(total) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
