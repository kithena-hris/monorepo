import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';

import type { PublishedVersion } from '../../domain/schema/publish.js';
import { define, noTransaction as tx } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import { buildExport, type ExportRequest } from './export.js';
import { asking, attributes, financeTenant, HR, MARCO, register } from './fixture.js';

/**
 * PEO-091: the Missing information sheet is a picture of the export's day,
 * and a blank no rule asks for reads grey (PRD §15.4).
 */

/** The register with `cost_centre` replaced, and the version renumbered and redated. */
function withCostCentre(
  over: Partial<Parameters<typeof define>[0]>,
  version: number,
  publishedAt: string,
): PublishedVersion {
  const base = register();
  const costCentre = attributes.find((a) => a.key === 'cost_centre');
  if (!costCentre) throw new Error('fixture has no cost_centre');
  return {
    ...base,
    version,
    publishedAt,
    document: {
      ...base.document,
      attributes: [
        ...base.document.attributes.filter((a) => a.key !== 'cost_centre'),
        define({ ...costCentre, ...over, key: 'cost_centre' }),
      ],
    },
  };
}

async function workbook(
  versions: PublishedVersion[],
  over: Partial<ExportRequest> = {},
  seed?: (s: ReturnType<typeof financeTenant>) => void,
) {
  const store = financeTenant(versions);
  seed?.(store);
  const built = await buildExport(
    tx,
    {
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      relations: store.deps.relations,
      records: store.deps,
      clock: store.deps.clock,
    },
    { ...asking(HR), format: 'xlsx', ...over },
  );
  if (!built.ok) throw new Error(built.error.message);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(built.value.files[0]?.bytes ?? new Uint8Array()) as never);
  return wb;
}

const missingRows = (wb: ExcelJS.Workbook) =>
  (wb.getWorksheet('Missing information')?.getSheetValues() ?? [])
    .slice(2)
    .map((row) => (row as unknown[])[4]);

const missingPeople = (wb: ExcelJS.Workbook) =>
  (wb.getWorksheet('Missing information')?.getSheetValues() ?? [])
    .slice(2)
    .map((row) => (row as unknown[])[1]);

describe('an asOf export', () => {
  const march = withCostCentre({ requiredness: { mode: 'never' } }, 3, '2026-03-01T00:00:00.000Z');
  const september = register();

  it('judges against the schema version in force on the day, not today', async () => {
    // Marco has no cost centre. It became required on 1 September.
    expect(missingRows(await workbook([march, september]))).toEqual(['cost_centre']);
    const june = await workbook([march, september], { asOf: '2026-06-01' });
    expect(missingRows(june)).toEqual([]);

    const about = june.getWorksheet('About this export');
    const judged = about?.getRow(8).values as unknown[];
    expect(judged.slice(1)).toEqual(['Missing information judged against schema version', 3]);
  });

  it('judges the values in force on the day, through history', async () => {
    const dated = withCostCentre({ effectiveDated: true }, 4, '2026-01-01T00:00:00.000Z');
    const seeded = (store: ReturnType<typeof financeTenant>) => {
      // Marco had a cost centre until August, and it was cleared.
      for (const [id, value, effectiveFrom] of [
        ['00000000-0000-4000-9000-0000000000h1', 'CC-9', '2026-01-01'],
        ['00000000-0000-4000-9000-0000000000h2', null, '2026-08-01'],
      ] as const) {
        store.history.push({
          id,
          personId: MARCO,
          attributeKey: 'cost_centre',
          value,
          effectiveFrom,
          recordedAt: `${effectiveFrom}T09:00:00.000Z`,
          actor: { kind: 'system', process: 'test' } as never,
          supersedes: null,
          eventId: null,
        });
      }
    };
    // Only Marco has history here; the others read blank on a dated day,
    // exactly as the profile `asOf` read shows them.
    expect(missingPeople(await workbook([dated], {}, seeded))).toEqual([MARCO]);
    expect(missingPeople(await workbook([dated], { asOf: '2026-06-01' }, seeded))).not.toContain(
      MARCO,
    );
  });

  it('has nothing missing on a day before anything was published', async () => {
    expect(missingRows(await workbook([september], { asOf: '2026-01-01' }))).toEqual([]);
  });
});

describe('a blank no rule asks for', () => {
  it('is grey with a comment; a missing one is amber; an optional one has no fill', async () => {
    // Required only in Spain; nobody in the fixture has a country.
    const spanish = withCostCentre(
      {
        requiredness: {
          mode: 'conditional',
          when: { clauses: [{ operand: 'country', in: ['ES'] }] },
        },
      },
      4,
      '2026-09-01T00:00:00.000Z',
    );
    const wb = await workbook([spanish]);
    const people = wb.getWorksheet('People');
    if (!people) throw new Error('no People sheet');
    const column = (people.getRow(2).values as unknown[]).indexOf('cost_centre');
    const marco = [3, 4, 5].find((n) => people.getRow(n).getCell(1).value === MARCO) ?? 0;

    const cell = people.getRow(marco).getCell(column);
    expect(cell.fill).toMatchObject({ fgColor: { argb: 'FFD9D9D9' } });
    expect(cell.note).toBe('not required for this person');
    expect(missingRows(wb)).toEqual([]);

    // A filled cell under the same rule is left alone.
    const other = [3, 4, 5].find((n) => n !== marco) ?? 0;
    expect(people.getRow(other).getCell(column).fill).toBeUndefined();
  });
});
