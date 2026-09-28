/**
 * A filter as data: conditions joined by all or any and, one level down,
 * groups of their own. Every change is a pure function from one filter to the
 * next, so the builder holds no copy of the truth and the operations are
 * tested as data.
 *
 * Presentation only. This describes what a person asked for, in the words the
 * screen used; turning it into a query is the caller's job, because only the
 * caller knows what "Team is Engineering" means in its own data.
 *
 * ### Values are strings
 *
 * A text, a number, an ISO date, an option key: the canonical form, never the
 * rendered label, so a relabelled option does not silently break a saved
 * filter. A range is two strings, either of which may be empty for "on or
 * after" and "on or before".
 */

/** What an operator asks for after it. */
export type FilterValueKind =
  /** Nothing: "is empty", "has missing information". */
  | 'none'
  | 'text'
  | 'number'
  | 'date'
  /** Two dates, either open. */
  | 'date-range'
  /** One of the field's options. */
  | 'option'
  /** Any of the field's options. */
  | 'options';

export interface FilterOperator {
  id: string;
  /** How it reads in a sentence: `is`, `is not`, `is after`. */
  label: string;
  value: FilterValueKind;
}

export interface FilterField {
  id: string;
  label: string;
  /** In the order to offer them. The first is the default. */
  operators: readonly FilterOperator[];
  /** For `option` and `options` operators. */
  options?: readonly { value: string; label: string }[];
}

export interface FilterCondition {
  id: string;
  field: string;
  operator: string;
  /** `[text]`, `[number]`, `[date]`, `[from, to]` or the chosen option keys. */
  values: readonly string[];
}

/** A group inside the filter, with its own all-or-any. One level only. */
export interface FilterSubgroup {
  id: string;
  match: 'all' | 'any';
  conditions: readonly FilterCondition[];
}

export interface FilterGroup {
  /** Whether every condition must hold, or any one of them. */
  match: 'all' | 'any';
  conditions: readonly FilterCondition[];
  /**
   * Groups joined to the conditions by the same `match`: "Engineering, and
   * Berlin or Remote". Only a builder with `allowGroups` adds them.
   */
  groups?: readonly FilterSubgroup[];
}

const kindOf = (fields: readonly FilterField[], c: FilterCondition): FilterValueKind | undefined =>
  fields.find((f) => f.id === c.field)?.operators.find((o) => o.id === c.operator)?.value;

/** Whether a condition says enough to apply: an operator that needs a value has one. */
export function isConditionComplete(
  fields: readonly FilterField[],
  condition: FilterCondition,
): boolean {
  const kind = kindOf(fields, condition);
  if (kind === undefined) return false;
  if (kind === 'none') return true;
  if (kind === 'date-range') return condition.values.some((v) => v !== '');
  return condition.values.length > 0 && condition.values.every((v) => v.trim() !== '');
}

/** Applies `change` to the conditions of the group `groupId`, or of the root when it is `null`. */
function mapConditions(
  root: FilterGroup,
  groupId: string | null,
  change: (conditions: readonly FilterCondition[]) => readonly FilterCondition[],
): FilterGroup {
  if (groupId === null) return { ...root, conditions: change(root.conditions) };
  return {
    ...root,
    groups: (root.groups ?? []).map((group) =>
      group.id === groupId ? { ...group, conditions: change(group.conditions) } : group,
    ),
  };
}

/** Adds a condition to the root (`groupId` null) or to one of its groups. */
export function addCondition(
  root: FilterGroup,
  groupId: string | null,
  condition: FilterCondition,
): FilterGroup {
  return mapConditions(root, groupId, (conditions) => [...conditions, condition]);
}

export function addGroup(root: FilterGroup, group: FilterSubgroup): FilterGroup {
  return { ...root, groups: [...(root.groups ?? []), group] };
}

export function setMatch(
  root: FilterGroup,
  groupId: string | null,
  match: FilterGroup['match'],
): FilterGroup {
  if (groupId === null) return { ...root, match };
  return {
    ...root,
    groups: (root.groups ?? []).map((group) =>
      group.id === groupId ? { ...group, match } : group,
    ),
  };
}

/** Removes a condition or a group, and a group left empty by the removal. */
export function removeItem(root: FilterGroup, id: string): FilterGroup {
  const next: FilterGroup = { ...root, conditions: root.conditions.filter((c) => c.id !== id) };
  if (root.groups === undefined) return next;
  return {
    ...next,
    groups: root.groups
      .filter((group) => group.id !== id)
      .map((group) => ({ ...group, conditions: group.conditions.filter((c) => c.id !== id) }))
      .filter((group) => group.conditions.length > 0),
  };
}

/**
 * Changes one condition. Picking a new field resets the operator to that
 * field's first and clears the values, since "is after 1 Jan 2024" means
 * nothing once the field is Team; picking an operator that asks for a
 * different kind of value clears them too.
 */
export function updateCondition(
  root: FilterGroup,
  id: string,
  patch: Partial<Pick<FilterCondition, 'field' | 'operator' | 'values'>>,
  fields: readonly FilterField[],
): FilterGroup {
  const update = (condition: FilterCondition): FilterCondition => {
    if (condition.id !== id) return condition;
    if (patch.field !== undefined && patch.field !== condition.field) {
      const field = fields.find((entry) => entry.id === patch.field);
      return {
        ...condition,
        field: patch.field,
        operator: field?.operators[0]?.id ?? '',
        values: [],
      };
    }
    if (patch.operator !== undefined && patch.operator !== condition.operator) {
      const before = kindOf(fields, condition);
      const after = kindOf(fields, { ...condition, operator: patch.operator });
      return {
        ...condition,
        ...patch,
        ...(before === after ? {} : { values: patch.values ?? [] }),
      };
    }
    return { ...condition, ...patch };
  };
  return {
    ...root,
    conditions: root.conditions.map(update),
    ...(root.groups === undefined
      ? {}
      : {
          groups: root.groups.map((group) => ({
            ...group,
            conditions: group.conditions.map(update),
          })),
        }),
  };
}

/** Every condition in the filter, the root's first, then each group's. */
export function conditionsOf(root: FilterGroup): FilterCondition[] {
  return [...root.conditions, ...(root.groups ?? []).flatMap((group) => group.conditions)];
}

/**
 * The filter in one sentence: `Team is Engineering and (Location is Berlin or
 * Remote)`. It is what people actually read to check a filter, so it says a
 * repeated field and operator once rather than on every value, and leaves out
 * a condition that does not yet say enough to apply.
 */
export function describeFilter(root: FilterGroup, fields: readonly FilterField[]): string {
  const labelOf = (field: FilterField, value: string): string =>
    field.options?.find((option) => option.value === value)?.label ?? value;

  const valueOf = (
    field: FilterField,
    kind: FilterValueKind,
    values: readonly string[],
  ): string => {
    switch (kind) {
      case 'none':
        return '';
      case 'options':
        return values.map((value) => labelOf(field, value)).join(' or ');
      case 'date-range': {
        // An open end reads as an ellipsis: "1 Jan – …" is on or after.
        const [from = '', to = ''] = values;
        return `${from === '' ? '…' : from} – ${to === '' ? '…' : to}`;
      }
      default:
        return labelOf(field, values[0] ?? '');
    }
  };

  const describe = (
    match: FilterGroup['match'],
    conditions: readonly FilterCondition[],
  ): string[] => {
    let previous: FilterCondition | null = null;
    return conditions.flatMap((condition) => {
      const field = fields.find((entry) => entry.id === condition.field);
      const operator = field?.operators.find((entry) => entry.id === condition.operator);
      if (field === undefined || operator === undefined) return [];
      if (!isConditionComplete(fields, condition)) return [];
      const repeat =
        match === 'any' &&
        previous?.field === condition.field &&
        previous.operator === condition.operator;
      previous = condition;
      const value = valueOf(field, operator.value, condition.values);
      if (repeat) return [value];
      return [[field.label, operator.label, value].filter((part) => part !== '').join(' ')];
    });
  };

  const join = (match: FilterGroup['match']): string => (match === 'all' ? ' and ' : ' or ');
  const parts = [
    ...describe(root.match, root.conditions),
    ...(root.groups ?? []).flatMap((group) => {
      const inner = describe(group.match, group.conditions);
      if (inner.length === 0) return [];
      const sentence = inner.join(join(group.match));
      return [inner.length > 1 ? `(${sentence})` : sentence];
    }),
  ];
  return parts.join(join(root.match));
}
