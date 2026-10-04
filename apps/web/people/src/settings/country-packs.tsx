import { Badge, DataTable, EmptyState, PageSection } from '@reach/ui';
import type { JSX } from 'react';

/**
 * Country packs (S21), a tab of Organisation beside the legal entities they
 * apply to: the identifiers, fields and rules each country needs, and which
 * of the company's entities are in that country. Read-only, for People
 * administrators.
 *
 * A pack is registry data seeded into the draft for an entity's country; after
 * the first publish its fields are the company's own. How strong a pack's
 * identifier check is (`check`) is drawn only when the server says: never a
 * guessed value.
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

export interface PackEntity {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly archived: boolean;
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

export function CountryPacks({
  packs,
  entities,
}: {
  readonly packs: readonly CountryPackRow[];
  readonly entities: readonly PackEntity[];
}): JSX.Element {
  const checked = packs.some((p) => p.check != null);
  const entitiesIn = (country: string) =>
    entities.filter((e) => !e.archived && e.country === country);
  return (
    <PageSection surface title="Country packs">
      <DataTable<CountryPackRow>
        label="Country packs"
        rows={packs}
        rowId={(p) => p.country}
        empty={
          <EmptyState
            title="No country packs"
            description="Packs arrive with People, one per country it has paperwork rules for."
          />
        }
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
                    <Badge key={e.id} size="sm">
                      {e.name}
                    </Badge>
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
      <p className="mt-4 text-sm text-fg-muted">
        Where no public check exists, the pack says so, and values are flagged for review instead of
        refused.
      </p>
    </PageSection>
  );
}
