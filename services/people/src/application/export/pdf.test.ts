import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { noTransaction as tx } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import type { Viewer } from '../person/ports.js';
import { utcCalendars } from '../org/org.js';
import { buildExport, type ExportRequest } from './export.js';
import { ADA, asking, financeTenant, HR, MANAGER, MARCO } from './fixture.js';
import { rosterPdf } from './pdf.js';

/**
 * The text of a PDF, page by page, read back through each font's ToUnicode
 * map: the glyphs are an embedded subset, so the bytes are glyph ids, not
 * letters. Enough of a reader for what pdfkit writes, and no more.
 */
function pages(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes).toString('latin1');
  const objects = new Map<string, { dict: string; stream: string | null }>();
  for (const m of raw.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/gu)) {
    const [, id = '', body = ''] = m;
    const at = body.indexOf('stream');
    const dict = at < 0 ? body : body.slice(0, at);
    let stream: string | null = null;
    if (at >= 0) {
      const start = body.indexOf('\n', at) + 1;
      const data = Buffer.from(body.slice(start, body.lastIndexOf('endstream')), 'latin1');
      stream = (dict.includes('FlateDecode') ? inflateSync(data) : data).toString('latin1');
    }
    objects.set(id, { dict, stream });
  }
  const cmap = (fontId: string): Map<number, string> => {
    const font = objects.get(fontId)?.dict ?? '';
    const ref = /\/ToUnicode (\d+) 0 R/u.exec(font)?.[1] ?? '';
    const text = objects.get(ref)?.stream ?? '';
    const map = new Map<number, string>();
    for (const [, from = '0', , list = ''] of text.matchAll(
      /<([0-9a-f]+)> <([0-9a-f]+)> \[([^\]]*)\]/giu,
    )) {
      // A ligature maps to two letters: `<0066 0069>` is "fi".
      [...list.matchAll(/<([0-9a-f ]*)>/giu)].forEach(([, hex = ''], i) => {
        const units = hex.replaceAll(' ', '').match(/.{4}/gu) ?? [];
        map.set(parseInt(from, 16) + i, String.fromCharCode(...units.map((u) => parseInt(u, 16))));
      });
    }
    return map;
  };
  const tree = [...objects.values()].find((o) => o.dict.includes('/Type /Pages'))?.dict ?? '';
  const kids = [...(/\/Kids \[([^\]]*)\]/u.exec(tree)?.[1]?.matchAll(/(\d+) 0 R/gu) ?? [])];
  const out: string[] = [];
  for (const [, pageId = ''] of kids) {
    const dict = objects.get(pageId)?.dict ?? '';
    const resources = objects.get(/\/Resources (\d+) 0 R/u.exec(dict)?.[1] ?? '')?.dict ?? '';
    const fonts = new Map(
      [...resources.matchAll(/\/(F\d+) (\d+) 0 R/gu)].map(([, name = '', id = '']) => [
        name,
        cmap(id),
      ]),
    );
    const content = objects.get(/\/Contents (\d+) 0 R/u.exec(dict)?.[1] ?? '')?.stream ?? '';
    let font = new Map<number, string>();
    let text = '';
    for (const [, name, hex] of content.matchAll(/\/(F\d+) [\d.]+ Tf|<([0-9a-f]+)>/giu)) {
      if (name !== undefined) font = fonts.get(name) ?? new Map<number, string>();
      else if (hex !== undefined) {
        for (const g of hex.match(/.{4}/gu) ?? []) text += font.get(parseInt(g, 16)) ?? '';
      }
    }
    out.push(text);
  }
  return out;
}

async function exported(viewer: Viewer, over: Partial<ExportRequest> = {}) {
  const store = financeTenant();
  const result = await buildExport(
    tx,
    {
      calendars: utcCalendars,
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      relations: store.deps.relations,
      records: store.deps,
      clock: store.deps.clock,
    },
    { ...asking(viewer), format: 'pdf', ...over },
  );
  if (!result.ok) throw new Error(result.error.message);
  const [file] = result.value.files;
  if (!file) throw new Error('no file');
  return { ...result.value, file, text: pages(file.bytes) };
}

describe('the PDF employee record', () => {
  it('is one person, headed as the profile is, with Not provided for a required gap', async () => {
    const { file, text } = await exported(HR, { recordOf: MARCO });
    expect(file.mediaType).toBe('application/pdf');
    expect(file.name).toMatch(/^record-E-Marco-\d{4}-\d{2}-\d{2}\.pdf$/u);
    const page = text.join('\n');
    expect(page).toContain('Marco Test');
    // Sections in profile order: Personal, then HR.
    expect(page).toMatch(/PersonalGiven nameMarco[\s\S]*HREmployee numberE-Marco/u);
    // Required and empty: printed, muted, never a blank.
    expect(page).toContain('Cost centreNot provided');
    expect(page).toContain('€60,000.50');
    expect(page).toContain('Senior');
    expect(page).not.toContain('never exported');
    expect(page).not.toContain('Ada');
  });

  it('counts what it withholds, and says so on every page with its number', async () => {
    const hr = await exported(HR, { recordOf: ADA });
    // Health notes: special-category, never in a standard export.
    expect(hr.text.join('')).toContain('1 field withheld from the requester');
    expect(hr.text.at(-1)).toMatch(/Page 1 of 1/u);
    expect(hr.text[0]).toMatch(/Generated \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC by /u);

    // A manager reads Ada's job title and nothing else HR and Finance hold.
    const manager = await exported(MANAGER, { recordOf: ADA });
    const page = manager.text.join('');
    expect(page).toContain('Job title');
    expect(page).not.toContain('Base salary');
    expect(page).not.toContain('1332');
    expect(page).toMatch(/(\d+) fields withheld from the requester/u);
    expect(manager.attributeKeys).toEqual(['job_title']);
  });

  it('refuses a person the viewer cannot see, and a record in any other format', async () => {
    const store = financeTenant();
    const deps = {
      calendars: utcCalendars,
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      relations: store.deps.relations,
      records: store.deps,
      clock: store.deps.clock,
    };
    const nobody = await buildExport(tx, deps, {
      ...asking(HR),
      format: 'pdf',
      recordOf: '00000000-0000-4000-8000-000000000999',
    });
    expect(nobody.ok).toBe(false);
    const xlsx = await buildExport(tx, deps, { ...asking(HR), format: 'xlsx', recordOf: ADA });
    expect(xlsx.ok ? null : xlsx.error.code).toBe('VALUE_INVALID');
  });
});

describe('the PDF roster', () => {
  it('is landscape, one row per person, with the filter printed in its header', async () => {
    const { file, text, rowCount } = await exported(HR, {
      fields: ['given_name', 'cost_centre', 'base_salary'],
      filter: 'Cost centre: CC-1',
    });
    expect(file.name).toMatch(/^people-.*\.pdf$/u);
    expect(rowCount).toBe(3);
    const raw = Buffer.from(file.bytes).toString('latin1');
    // A4 on its side.
    expect(raw).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/u);
    const page = text[0] ?? '';
    expect(page).toContain('Filter: Cost centre: CC-1');
    // Profile order, whatever order they were asked in.
    expect(page).toContain('Given nameBase salaryCost centre');
    expect(page).toContain('Marco€60,000.50Not provided');
    expect(page).toContain('No fields withheld');
  });

  it('prints Withheld in a cell the viewer cannot read on that person, and counts it', async () => {
    const { text } = await exported(MANAGER, { fields: ['job_title'] });
    const page = text.join('');
    // Ada reports to Marco; Marco himself and Grace, his manager, are withheld.
    expect(page).toContain('=HYPERLINK("https://evil.test","x")WithheldWithheld');
    expect(page).toContain('2 fields withheld from the requester');
  });

  it('repeats the header and the filter on every page', async () => {
    const bytes = await rosterPdf({
      title: 'People roster',
      lines: ['Filter: Everyone you can see'],
      generatedAt: '2026-09-26 10:00 UTC',
      generatedBy: 'someone',
      withheld: 0,
      headers: ['Name', 'Łukasz column'],
      rows: Array.from({ length: 120 }, (_, i) => [{ text: `Person ${String(i)}` }, { text: 'x' }]),
    });
    const text = pages(bytes);
    expect(text.length).toBeGreaterThan(1);
    text.forEach((p, i) => {
      expect(p).toContain('Filter: Everyone you can see');
      expect(p).toContain('NameŁukasz column');
      expect(p).toContain(`Page ${String(i + 1)} of ${String(text.length)}`);
    });
  });
});
