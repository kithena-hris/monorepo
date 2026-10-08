import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  DatePicker,
  formatMoney,
  Field,
  FieldDescription,
  FieldLabel,
  Icon,
  List,
  ListItem,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
} from '@reach/ui-native';
import { Plus, X } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Failed, Loading, Page } from '../frame';
import {
  ask,
  formInputs,
  useRead,
  useSigned,
  valueOf,
  type Entry,
  type RecordField,
  type Value,
} from './api';
import { AttributeInput } from './attribute-input';
import type { PeopleScreen } from './routes';

interface BulkState {
  readonly people: readonly { readonly id: string; readonly name: string }[];
  readonly sections: readonly {
    readonly key: string;
    readonly label: string;
    readonly fields: readonly RecordField[];
  }[];
  readonly today: string;
  readonly limit: number;
  readonly placement: {
    readonly entities: readonly { value: string; label: string }[];
    readonly locations: readonly { value: string; label: string; legalEntityId: string }[];
  } | null;
}

interface Row {
  readonly personId: string;
  readonly name: string;
  readonly outcome: 'changed' | 'unchanged' | 'refused' | 'held';
  readonly held: readonly string[] | null;
  readonly changes: readonly {
    key: string;
    label: string;
    dated: boolean;
    before: Entry;
    after: Entry;
  }[];
  readonly refusal: { readonly code: string; readonly message: string } | null;
}

interface Done {
  readonly committed: boolean;
  readonly rows: readonly Row[];
}

const OUTCOME: Readonly<
  Record<Row['outcome'], { label: string; tone: 'success' | 'neutral' | 'danger' | 'warning' }>
> = {
  changed: { label: 'Changes', tone: 'success' },
  unchanged: { label: 'Already so', tone: 'neutral' },
  refused: { label: 'Skipped', tone: 'danger' },
  held: { label: 'For approval', tone: 'warning' },
};

/** A value in words, for a before and after: never more than the record would show. */
function said(entry: Entry): string {
  const v = valueOf(entry);
  if (v === null || v === '') return 'empty';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if ('last4' in v) return v.last4 === null ? 'hidden' : `•••• ${v.last4}`;
  if ('amountMinor' in v)
    return v.amountMinor === '' ? 'empty' : formatMoney(v.amountMinor, v.currency);
  return v.join(', ');
}

/** Every page in turn, `limit` people a request, stopping at the first refusal of a page. */
async function pages(
  ids: readonly string[],
  limit: number,
  act: (
    ids: readonly string[],
  ) => Promise<{ ok: true; data: Done } | { ok: false; message: string }>,
): Promise<{ rows: Row[]; committed: boolean; problem: string | null }> {
  const rows: Row[] = [];
  let committed = false;
  for (let at = 0; at < ids.length; at += limit) {
    const answer = await act(ids.slice(at, at + limit));
    if (!answer.ok) {
      return {
        rows,
        committed,
        problem:
          rows.length === 0
            ? answer.message
            : `${answer.message}. Stopped after ${String(rows.length)} of ${String(ids.length)} people; the rest were not done.`,
      };
    }
    committed = answer.data.committed;
    rows.push(...answer.data.rows);
  }
  return { rows, committed, problem: null };
}

function Rows({ rows }: { rows: readonly Row[] }): React.JSX.Element {
  return (
    <List>
      {rows.map((r) => (
        <ListItem
          key={r.personId}
          description={
            r.refusal !== null
              ? r.refusal.message
              : r.changes
                  .map(
                    (c) =>
                      `${c.label}: ${said(c.before)} → ${said(c.after)}${c.dated ? '' : ' (on the day)'}`,
                  )
                  .join('\n') || undefined
          }
          trailing={
            <Badge size="sm" tone={OUTCOME[r.outcome].tone}>
              {OUTCOME[r.outcome].label}
            </Badge>
          }
        >
          {r.name}
        </ListItem>
      ))}
    </List>
  );
}

/**
 * The people chosen in the Directory, changed together (the web's bulk edit):
 * the same values from one date, or hired from a start date and placed.
 * Nothing is written before a preview has shown, per person, what would
 * change from what to what and what would be refused; changing anything sets
 * the preview aside, so what is applied is what was last shown.
 */
export function BulkEdit({ navigation, route }: PeopleScreen<'BulkEdit'>): React.JSX.Element {
  const { load, reload } = useRead<BulkState>('BulkEdit', { personIds: route.params.personIds });
  const [tab, setTab] = useState<'edit' | 'hire'>('edit');
  const back = { label: 'Directory', onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title="Edit people" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading the people" />
        )}
      </Page>
    );
  }
  const state = load.data;
  const n = state.people.length;
  return (
    <Page
      title={
        tab === 'edit' ? `Edit ${String(n)} ${n === 1 ? 'person' : 'people'}` : `Hire ${String(n)}`
      }
      back={back}
    >
      <Text variant="footnote" tone="muted" numberOfLines={3}>
        {state.people.map((p) => p.name).join(', ')}
      </Text>
      <SegmentedControl
        fullWidth
        value={tab}
        accessibilityLabel="What to do"
        onValueChange={(v) => {
          setTab(v === 'hire' ? 'hire' : 'edit');
        }}
      >
        <SegmentedControlItem value="edit">Set values</SegmentedControlItem>
        <SegmentedControlItem value="hire">Hire</SegmentedControlItem>
      </SegmentedControl>
      {tab === 'edit' ? (
        <SetValues state={state} onDone={navigation.goBack} />
      ) : (
        <Hire state={state} onDone={navigation.goBack} />
      )}
    </Page>
  );
}

function SetValues({ state, onDone }: { state: BulkState; onDone: () => void }): React.JSX.Element {
  const signed = useSigned();
  const fields = state.sections.flatMap((s) => s.fields);
  const [chosen, setChosen] = useState<readonly string[]>(
    fields[0] === undefined ? [] : [fields[0].key],
  );
  const [values, setValues] = useState<Readonly<Record<string, Value>>>({});
  const [effectiveFrom, setEffectiveFrom] = useState(state.today);
  const [withoutApproval, setWithoutApproval] = useState(false);
  const [shown, setShown] = useState<{ committed: boolean; rows: readonly Row[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const sensitive = fields.filter((f) => f.sensitive === true && chosen.includes(f.key));
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const open = fields.filter((f) => !chosen.includes(f.key));
  const reset = (): void => {
    setShown(null);
    setProblem(null);
  };
  const run = async (operation: 'BulkEditPreview' | 'BulkEditPeople'): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const done = await pages(
      state.people.map((p) => p.id),
      state.limit,
      (ids) =>
        ask<Done>(signed, operation, {
          personIds: ids,
          values: formInputs(Object.fromEntries(chosen.map((k) => [k, values[k] ?? null]))),
          effectiveFrom,
          ...(withoutApproval && sensitive.length > 0
            ? { applySensitiveWithoutApproval: true }
            : {}),
        }),
    );
    setProblem(done.problem);
    setShown(done.rows.length === 0 ? null : { committed: done.committed, rows: done.rows });
    setBusy(false);
  };
  const count = (o: Row['outcome']): number =>
    shown?.rows.filter((r) => r.outcome === o).length ?? 0;
  return (
    <>
      {chosen.map((key) => {
        const field = byKey.get(key);
        if (field === undefined) return null;
        return (
          <Card key={key} variant="outline">
            <Stack gap={2}>
              <View className="flex-row items-center gap-2">
                <View className="flex-1">
                  <Select
                    value={key}
                    onValueChange={(next) => {
                      reset();
                      setChosen((c) => c.map((k) => (k === key ? next : k)));
                    }}
                  >
                    <SelectTrigger size="sm" accessibilityLabel="Field">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[field, ...open].map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </View>
                {chosen.length === 1 ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    startIcon={<Icon icon={X} />}
                    accessibilityLabel={`Remove ${field.label}`}
                    onPress={() => {
                      reset();
                      setChosen((c) => c.filter((k) => k !== key));
                    }}
                  />
                )}
              </View>
              <AttributeInput
                field={{ ...field, required: false }}
                value={values[key] ?? null}
                onChange={(next) => {
                  reset();
                  setValues((v) => ({ ...v, [key]: next }));
                }}
              />
            </Stack>
          </Card>
        );
      })}
      {open.length === 0 ? null : (
        <Button
          size="sm"
          variant="ghost"
          startIcon={<Icon icon={Plus} />}
          onPress={() => {
            reset();
            setChosen((c) => [...c, open[0]?.key ?? '']);
          }}
        >
          Add a field
        </Button>
      )}
      <DatePicker
        label="Takes effect from"
        size="sm"
        value={effectiveFrom}
        onChange={(next) => {
          reset();
          setEffectiveFrom(next ?? state.today);
        }}
      />
      <Text variant="footnote" tone="muted">
        Empty clears the field. Fields kept without dates change on the day.
      </Text>
      {sensitive.length === 0 ? null : (
        <ListItem
          listitem={false}
          description={`${sensitive.map((f) => f.label).join(', ')} would wait for approval. Applied straight through, it is recorded as such.`}
          leading={
            <Checkbox
              checked={withoutApproval}
              accessibilityLabel="Apply sensitive values without approval"
              onCheckedChange={(on) => {
                reset();
                setWithoutApproval(on);
              }}
            />
          }
        >
          Apply sensitive values without approval
        </ListItem>
      )}
      {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
      {shown === null ? null : shown.committed ? (
        <Alert tone="success" title={`${String(count('changed'))} changed`}>
          {`${String(count('held'))} wait for approval, ${String(count('refused'))} skipped.`}
        </Alert>
      ) : (
        <Text weight="semibold">{`${String(count('changed'))} would change, ${String(count('held'))} wait for approval, ${String(count('refused'))} skipped`}</Text>
      )}
      {shown === null ? null : <Rows rows={shown.rows} />}
      {shown?.committed === true ? (
        <Button variant="primary" onPress={onDone}>
          Back to the Directory
        </Button>
      ) : shown === null ? (
        <Button
          variant="primary"
          loading={busy}
          disabled={chosen.length === 0}
          onPress={() => void run('BulkEditPreview')}
        >
          Preview
        </Button>
      ) : (
        <Button
          variant="primary"
          loading={busy}
          disabled={count('changed') + count('held') === 0}
          onPress={() => void run('BulkEditPeople')}
        >
          {`Apply to ${String(count('changed') + count('held'))}`}
        </Button>
      )}
    </>
  );
}

interface Placed {
  readonly entity: string;
  readonly location: string;
}
const NOWHERE: Placed = { entity: '', location: '' };

function Hire({ state, onDone }: { state: BulkState; onDone: () => void }): React.JSX.Element {
  const signed = useSigned();
  const [day, setDay] = useState(state.today);
  const [place, setPlace] = useState<Placed>(NOWHERE);
  const [dates, setDates] = useState<Readonly<Record<string, string>>>({});
  const [places, setPlaces] = useState<Readonly<Record<string, Placed>>>({});
  const [shown, setShown] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const placeOf = (id: string): Placed => places[id] ?? place;
  const hires = state.people.map(({ id }) => {
    const { entity, location } = placeOf(id);
    return {
      personId: id,
      hireDate: dates[id] ?? day,
      ...(entity === '' ? {} : { legalEntityId: entity }),
      ...(location === '' ? {} : { locationId: location }),
    };
  });
  const reset = (): void => {
    setShown(null);
    setProblem(null);
  };
  const run = async (operation: 'BulkHirePreview' | 'BulkHirePeople'): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const byId = new Map(hires.map((h) => [h.personId, h]));
    const done = await pages(
      hires.map((h) => h.personId),
      state.limit,
      (ids) => ask<Done>(signed, operation, { hires: ids.flatMap((id) => byId.get(id) ?? []) }),
    );
    setProblem(done.problem);
    setShown(done.rows.length === 0 ? null : { committed: done.committed, rows: done.rows });
    setBusy(false);
  };
  const pickers = (value: Placed, onChange: (p: Placed) => void, who?: string) =>
    state.placement === null ? null : (
      <>
        <Field>
          <FieldLabel>{who === undefined ? 'Legal entity' : `${who}: legal entity`}</FieldLabel>
          <Select
            value={value.entity}
            onValueChange={(entity) => {
              reset();
              onChange({ entity, location: '' });
            }}
          >
            <SelectTrigger size="sm" accessibilityLabel="Legal entity">
              <SelectValue placeholder="Where they are employed" />
            </SelectTrigger>
            <SelectContent>
              {state.placement.entities.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>{who === undefined ? 'Work location' : `${who}: work location`}</FieldLabel>
          <Select
            value={value.location}
            onValueChange={(location) => {
              reset();
              onChange({
                entity:
                  state.placement?.locations.find((l) => l.value === location)?.legalEntityId ??
                  value.entity,
                location,
              });
            }}
          >
            <SelectTrigger size="sm" accessibilityLabel="Work location">
              <SelectValue placeholder="Where they work" />
            </SelectTrigger>
            <SelectContent>
              {state.placement.locations
                .filter((l) => value.entity === '' || l.legalEntityId === value.entity)
                .map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <FieldDescription>Anyone already placed keeps their placement.</FieldDescription>
        </Field>
      </>
    );
  const nowhere = shown?.rows.filter((r) => r.refusal?.code === 'PLACEMENT_REQUIRED') ?? [];
  const hired = shown?.rows.filter((r) => r.outcome === 'changed').length ?? 0;
  return (
    <>
      <Text tone="muted">People without a start date become employees on the date you choose.</Text>
      <DatePicker
        label="Start date"
        size="sm"
        value={day}
        onChange={(next) => {
          reset();
          setDay(next ?? state.today);
        }}
      />
      {pickers(place, setPlace)}
      {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
      {shown === null ? null : (
        <>
          {nowhere.length === 0 ? null : (
            <Alert
              tone="neutral"
              title={`${nowhere.map((r) => r.name).join(', ')} ${nowhere.length === 1 ? 'is' : 'are'} placed nowhere`}
            >
              Choose where they work below.
            </Alert>
          )}
          <Rows rows={shown.rows} />
          {shown.committed
            ? null
            : shown.rows.map((r) => (
                <Card key={r.personId} variant="outline">
                  <Stack gap={2}>
                    <DatePicker
                      label={`Start date for ${r.name}`}
                      size="sm"
                      value={dates[r.personId] ?? day}
                      onChange={(next) => {
                        reset();
                        setDates((d) => ({ ...d, [r.personId]: next ?? day }));
                      }}
                    />
                    {r.refusal?.code === 'PLACEMENT_REQUIRED'
                      ? pickers(
                          placeOf(r.personId),
                          (p) => {
                            setPlaces((all) => ({ ...all, [r.personId]: p }));
                          },
                          r.name,
                        )
                      : null}
                  </Stack>
                </Card>
              ))}
        </>
      )}
      {shown?.committed === true ? (
        <>
          <Alert tone="success" title={`${String(hired)} hired`} />
          <Button variant="primary" onPress={onDone}>
            Back to the Directory
          </Button>
        </>
      ) : shown === null ? (
        <Button variant="primary" loading={busy} onPress={() => void run('BulkHirePreview')}>
          Preview
        </Button>
      ) : (
        <Button
          variant="primary"
          loading={busy}
          disabled={hired === 0}
          onPress={() => void run('BulkHirePeople')}
        >
          {`Hire ${String(hired)}`}
        </Button>
      )}
    </>
  );
}
