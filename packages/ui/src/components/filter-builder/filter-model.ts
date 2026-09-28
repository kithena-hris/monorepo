/**
 * A filter as data: a group of conditions and, one level down, groups of
 * their own. Every change is a pure function from one tree to the next, so
 * the builder holds no copy of the truth and the operations are tested as
 * data.
 *
 * Presentation only. This describes what a person asked for, in the words the
 * screen used; turning it into a query is the caller's job, because only the
 * caller knows what "Team is Engineering" means in its own data.
 */

export interface FilterCondition {
  kind: 'condition';
  id: string;
  /** A `FilterField` id. Empty until a field is picked. */
  field: string;
  /** An operator id of that field. */
  operator: string;
  value: string;
}

export interface FilterGroup {
  kind: 'group';
  id: string;
  /** Whether every item must hold, or any one of them. */
  match: 'all' | 'any';
  items: readonly FilterItem[];
}

export type FilterItem = FilterCondition | FilterGroup;

export interface FilterOperator {
  id: string;
  /** How it reads in a sentence: `is`, `is not`, `is after`. */
  label: string;
}

export interface FilterField {
  id: string;
  label: string;
  operators: readonly FilterOperator[];
  /** The values to choose from. Omitted, the value is typed. */
  options?: readonly { value: string; label: string }[];
  /** For a typed value: the keyboard and the validation the browser brings. */
  inputType?: 'text' | 'number' | 'date';
}

/** Applies `change` to the group with `id`, wherever it sits. */
function mapGroup(
  group: FilterGroup,
  id: string,
  change: (target: FilterGroup) => FilterGroup,
): FilterGroup {
  if (group.id === id) return change(group);
  return {
    ...group,
    items: group.items.map((item) => (item.kind === 'group' ? mapGroup(item, id, change) : item)),
  };
}

export function addItem(root: FilterGroup, groupId: string, item: FilterItem): FilterGroup {
  return mapGroup(root, groupId, (group) => ({ ...group, items: [...group.items, item] }));
}

export function setMatch(
  root: FilterGroup,
  groupId: string,
  match: FilterGroup['match'],
): FilterGroup {
  return mapGroup(root, groupId, (group) => ({ ...group, match }));
}

/** Removes a condition or a group, and a group left empty by the removal. */
export function removeItem(root: FilterGroup, id: string): FilterGroup {
  const prune = (group: FilterGroup): FilterGroup => ({
    ...group,
    items: group.items.flatMap((item): FilterItem[] => {
      if (item.id === id) return [];
      if (item.kind === 'condition') return [item];
      const next = prune(item);
      return next.items.length === 0 ? [] : [next];
    }),
  });
  return prune(root);
}

/**
 * Changes one condition. Picking a new field resets the operator to that
 * field's first and clears the value, since "is after 1 Jan 2024" means nothing
 * once the field is Team.
 */
export function updateCondition(
  root: FilterGroup,
  id: string,
  patch: Partial<Pick<FilterCondition, 'field' | 'operator' | 'value'>>,
  fields: readonly FilterField[],
): FilterGroup {
  const update = (group: FilterGroup): FilterGroup => ({
    ...group,
    items: group.items.map((item) => {
      if (item.kind === 'group') return update(item);
      if (item.id !== id) return item;
      if (patch.field !== undefined && patch.field !== item.field) {
        const field = fields.find((entry) => entry.id === patch.field);
        return { ...item, field: patch.field, operator: field?.operators[0]?.id ?? '', value: '' };
      }
      return { ...item, ...patch };
    }),
  });
  return update(root);
}

/** Every condition in the tree, depth first. */
export function conditionsOf(group: FilterGroup): FilterCondition[] {
  return group.items.flatMap((item) => (item.kind === 'group' ? conditionsOf(item) : [item]));
}

/**
 * The filter in one sentence: `Team is Engineering and (Location is Berlin or
 * Remote)`. It is what people actually read to check a filter, so it says a
 * repeated field and operator once rather than on every value.
 */
export function describeFilter(group: FilterGroup, fields: readonly FilterField[]): string {
  const valueLabel = (field: FilterField | undefined, value: string): string =>
    field?.options?.find((option) => option.value === value)?.label ?? value;

  const describe = (target: FilterGroup, nested: boolean): string => {
    const join = target.match === 'all' ? ' and ' : ' or ';
    let previous: FilterCondition | null = null;
    const parts = target.items.flatMap((item) => {
      if (item.kind === 'group') {
        previous = null;
        const inner = describe(item, true);
        return inner ? [inner] : [];
      }
      const field = fields.find((entry) => entry.id === item.field);
      if (!field || item.value === '') return [];
      const operator = field.operators.find((entry) => entry.id === item.operator);
      const repeat = previous?.field === item.field && previous.operator === item.operator;
      previous = item;
      const value = valueLabel(field, item.value);
      return [repeat ? value : `${field.label} ${operator?.label ?? item.operator} ${value}`];
    });
    const sentence = parts.join(join);
    return nested && parts.length > 1 ? `(${sentence})` : sentence;
  };

  return describe(group, false);
}
