import { Badge, DataTable, EmptyState, PageHeader, Stack } from '@reach/ui';
import type { JSX } from 'react';

import { Loaded, type Loadable } from '../load';

/**
 * Country packs (S21): the identifiers, fields and rules each country needs,
 * and which of the company's legal entities are in that country.
 *
 * A pack is registry data seeded into the draft for an entity's country; after
 * the first publish its fields are the company's own. What a pack adds and
 * where it applies is read from People. Turning a pack on or off per entity
 * is drawn only when the server offers it (`onToggle`), and so is how strong
 * its identifier check is (`check`): neither is shown with a guessed value.
 */
export interface CountryPackRow {
  readonly country: string;
  readonly countryName: string;
  /** How many fields the pack adds. */
  readonly fields: number;
  readonly sections: readonly { readonly label: string }[];
  /**
   * How its identifiers are checked, when the server says: a checksum, the
   * issuing authority's allocation rules, number ranges, or only the shape.
   */
  readonly check?: 'checksum' | 'allocation' | 'ranges' | 'shape' | null;
}

export interface CountryPacksState {
  readonly packs: readonly CountryPackRow[];
  readonly entities: readonly {
    readonly id: string;
    readonly name: string;
    readonly country: string;
    readonly archived: boolean;
  }[];
}

export interface CountryPacksProps {
  readonly load: Loadable<CountryPacksState>;
}

const CHECK: Record<
  NonNullable<CountryPackRow['check']>,
  { readonly label: string; readonly tone: 'success' | 'info' | 'warning' }
> = {
  checksum: { label: 'Checksum', tone: 'success' },
  allocation: { label: 'Allocation rules', tone: 'success' },
  ranges: { label: 'Ranges', tone: 'info' },
  shape: { label: 'Shape only', tone: 'warning' },
};

export function CountryPacks({ load }: CountryPacksProps): JSX.Element {
  return (
    <Stack gap={6}>
      <PageHeader
        title="Country packs"
        description="The identifiers, fields and rules each country needs, and the legal entities they apply to."
      />
      <Loaded load={load} what="the country packs">
        {(state) => <Packs state={state} />}
      </Loaded>
    </Stack>
  );
}

function Packs({ state }: { readonly state: CountryPacksState }): JSX.Element {
  if (state.packs.length === 0) {
    return (
      <EmptyState
        title="No country packs"
        description="Packs arrive with People, one per country it has paperwork rules for."
      />
    );
  }
  const checked = state.packs.some((p) => p.check != null);
  const entitiesIn = (country: string) =>
    state.entities.filter((e) => !e.archived && e.country === country);
  return (
    <Stack gap={4}>
      <DataTable<CountryPackRow>
        label="Country packs"
        rows={state.packs}
        rowId={(p) => p.country}
        columns={[
          {
            id: 'country',
            header: 'Country',
            cell: (p) => <span className="font-semibold">{p.countryName}</span>,
          },
          {
            id: 'adds',
            header: 'Adds',
            cell: (p) => (
              <span className="whitespace-normal">
                {p.sections.map((s) => s.label).join(', ')} ·{' '}
                {`${String(p.fields)} ${p.fields === 1 ? 'field' : 'fields'}`}
              </span>
            ),
          },
          {
            id: 'entities',
            header: 'Entities',
            cell: (p) => {
              const here = entitiesIn(p.country);
              return here.length === 0 ? (
                <span className="text-sm text-fg-muted">No entity yet</span>
              ) : (
                <span className="flex flex-wrap gap-1.5">
                  {here.map((e) => (
                    <Badge key={e.id}>{e.name}</Badge>
                  ))}
                </span>
              );
            },
          },
          ...(checked
            ? [
                {
                  id: 'check',
                  header: 'Check',
                  cardTrailing: true,
                  cell: (p: CountryPackRow) =>
                    p.check == null ? null : (
                      <Badge tone={CHECK[p.check].tone}>{CHECK[p.check].label}</Badge>
                    ),
                },
              ]
            : []),
        ]}
      />
      <p className="text-sm text-fg-muted">
        Where no public check exists, the pack says so, and values are flagged for review instead of
        refused.
      </p>
    </Stack>
  );
}
