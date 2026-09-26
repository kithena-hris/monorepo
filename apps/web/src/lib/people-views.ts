/**
 * People's GraphQL answers, back in the shape the remote's screens draw from
 * (PEO-113).
 *
 * The screens were built against `/v1/views/*`, whose records are objects
 * keyed by attribute. GraphQL cannot have a field per attribute without
 * answering null for one the viewer may not read, so People sends a record's
 * values as a keyed list of a union, and this puts them back into an object.
 * A key that was not in the list is not in the object: absence survives the
 * trip, and nothing is invented to fill it.
 *
 * Pure, and no `server-only`, so it is tested on its own.
 */

type Json = Record<string, unknown>;

interface Entry {
  readonly __typename: string;
  readonly key: string;
  readonly text?: string;
  readonly flag?: boolean;
  readonly items?: readonly string[];
  readonly amountMinor?: string;
  readonly currency?: string;
  readonly last4?: string | null;
}

/** One `FormEntry` as the form value the remote holds. */
function formValue(entry: Entry): unknown {
  switch (entry.__typename) {
    case 'TextEntry':
      return entry.text ?? '';
    case 'FlagEntry':
      return entry.flag === true;
    case 'ListEntry':
      return [...(entry.items ?? [])];
    case 'MoneyEntry':
      return { amountMinor: entry.amountMinor ?? '', currency: entry.currency ?? '' };
    case 'SealedEntry':
      return { last4: entry.last4 ?? null };
    default:
      return null;
  }
}

/** A record's values: the keyed list, as an object with those keys and no others. */
export function formValues(entries: readonly Entry[]): Json {
  return Object.fromEntries(entries.map((e) => [e.key, formValue(e)]));
}

/** An optional field is absent in the view model, where GraphQL can only say null. */
function absentIfNull<T extends Json>(value: T, keys: readonly string[]): T {
  return Object.fromEntries(
    Object.entries(value).filter(([key, v]) => !(keys.includes(key) && v === null)),
  ) as T;
}

const field = (f: Json) => absentIfNull(f, ['currency', 'ownedBy', 'keptIn']);
/** A change waiting for approval (PEO-077): its value from its entry, masked as it came. */
const pending = (p: Json & { value: Entry }) => ({ ...p, value: formValue(p.value) });
const section = (s: Json & { fields: Json[] }) => ({ ...s, fields: s.fields.map(field) });

interface WithRecord {
  readonly sections: (Json & { fields: Json[] })[];
  readonly values: Entry[];
}
const record = <T extends WithRecord>(v: T) => ({
  ...v,
  sections: v.sections.map(section),
  values: formValues(v.values),
});

/** Strip `__typename` from an import stage; `step` already says which it is. */
function stage(s: Json): Json {
  return Object.fromEntries(Object.entries(s).filter(([key]) => key !== '__typename'));
}

/** Each screen's answer as its view model, by the component that draws it. */
export const VIEWS = {
  Onboarding: (v: WithRecord & Json) => record(v),
  Profile: (v: WithRecord & Json & { pending?: (Json & { value: Entry })[] }) => ({
    ...record(v),
    pending: (v.pending ?? []).map(pending),
  }),
  Approvals: (v: Json & { items: (Json & { value: Entry; current: Entry })[] }) => ({
    ...v,
    items: v.items.map((i) => ({ ...pending(i), current: formValue(i.current) })),
  }),
  // Each change's value too, from its entry: a sealed one stays `{ last4: null }`.
  PersonHistory: (v: WithRecord & Json & { changes: (Json & { value: Entry })[] }) => ({
    ...record(v),
    changes: v.changes.map((c) => ({ ...c, value: formValue(c.value) })),
  }),
  Directory: (v: Json & { people: (Json & { values: { key: string; value: string }[] })[] }) => ({
    ...v,
    people: v.people.map((p) => ({
      ...p,
      values: Object.fromEntries(p.values.map((cell) => [cell.key, cell.value])),
    })),
  }),
  BulkEdit: (v: Json & { sections: (Json & { fields: Json[] })[] }) => ({
    ...v,
    sections: v.sections.map(section),
  }),
  // Each change's two values as form values, as a record's are.
  BulkEditResult: (v: Json & { rows: (Json & { changes: (Json & { before: Entry; after: Entry })[] })[] }) => ({
    ...v,
    rows: v.rows.map((r) => ({
      ...r,
      changes: r.changes.map((c) => ({ ...c, before: formValue(c.before), after: formValue(c.after) })),
    })),
  }),
  PeopleSetup: (
    v: Json & { profile: (WithRecord & { pending?: (Json & { value: Entry })[] }) | null },
  ) => ({
    ...absentIfNull(v, ['legalEntity']),
    profile:
      v.profile === null
        ? null
        : { ...record(v.profile), pending: (v.profile.pending ?? []).map(pending) },
  }),
  // A figure the view model always has as null, and GraphQL does not carry.
  Analytics: (v: Json) => ({ ...v, funnel: null }),
  Advice: (v: Json) => absentIfNull(v, ['classification', 'reason', 'floor']),
  ImportStage: stage,
} as const;
