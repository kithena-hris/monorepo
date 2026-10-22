import { randomUUID } from 'node:crypto';
import { CalendarDate, Instant, TenantId, type PersonId } from '@kithena/contracts';
import type { Clock } from '@kithena/domain-kit';
import { describe, expect, it } from 'vitest';

import { memoryBlobs, memoryUnitOfWork } from '../testing/memory.js';
import { describeCompany, domainsFor, uploadLogo } from './company.js';
import { contextOf, type Ctx } from './context.js';
import type { Deps } from './ports.js';
import {
  removeBenefit,
  removeEntity,
  removeLocation,
  removeOrgUnit,
  removePipeline,
  saveEntity,
  saveLocation,
  saveOrgUnit,
  savePipeline,
  saveQuestionnaire,
  DEFAULT_SETTINGS,
} from './setup.js';

/**
 * Settings that can be taken away again (S1, S2, S6), and what People owns
 * staying People's: a row that came from its events is shown and tied to,
 * never renamed or removed here.
 */

const tenantId = TenantId.parse(randomUUID());
const at = '2026-10-20T09:00:00.000Z';
const clock: Clock = {
  now: () => new Date(at),
  today: () => at.slice(0, 10),
  instant: () => Instant.parse(at),
  date: () => CalendarDate.parse(at.slice(0, 10)),
};

function harness(extra: Partial<Deps> = {}) {
  const uow = memoryUnitOfWork();
  const deps: Deps = {
    ...extra,
    uow,
    blobs: memoryBlobs(),
    clock,
    newId: randomUUID,
    jobsOrigin: 'https://jobs.example',
    extractText: () => Promise.resolve(''),
  };
  const admin = randomUUID() as PersonId;
  const asAdmin = <T>(fn: (ctx: Ctx) => Promise<T>): Promise<T> =>
    uow.run(tenantId, async (tx) => {
      await tx.admins.add('account-admin');
      return fn(
        await contextOf(deps, tx, {
          tenantId,
          accountId: 'account-admin',
          personId: admin,
          correlationId: randomUUID(),
        }),
      );
    });
  return { uow, deps, asAdmin };
}

// GB: a country whose pack ships statutory benefits (pension auto-enrolment).
const entity = (id: string, source?: 'people') => ({
  id,
  name: 'Acme Ltd',
  country: 'GB' as const,
  currency: 'GBP',
  fullTimeWeeklyMinutes: 2400,
  headcount: 10,
  foundedOn: null,
  worksCouncil: false,
  worksCouncilIds: [],
  ...(source === undefined ? {} : { source }),
});

describe('removing settings', () => {
  it('removes an entity of Recruiting’s own with its statutory benefits, once its locations are gone', async () => {
    const { uow, asAdmin } = harness();
    const id = randomUUID();
    expect((await asAdmin((ctx) => saveEntity(ctx, entity(id)))).ok).toBe(true);
    const benefits = await uow.run(tenantId, (tx) => tx.benefits.list());
    expect(benefits.some((b) => b.legalEntityId === id && b.statutory)).toBe(true);
    const location = randomUUID();
    await asAdmin((ctx) =>
      saveLocation(ctx, {
        id: location,
        name: 'London',
        entityId: id,
        country: 'GB',
        region: null,
        city: 'London',
        timeZone: 'Europe/London',
      }),
    );
    const blocked = await asAdmin((ctx) => removeEntity(ctx, id));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('IN_USE');
    expect((await asAdmin((ctx) => removeLocation(ctx, location))).ok).toBe(true);
    expect((await asAdmin((ctx) => removeEntity(ctx, id))).ok).toBe(true);
    expect(await uow.run(tenantId, (tx) => tx.entities.get(id))).toBeNull();
    expect(
      (await uow.run(tenantId, (tx) => tx.benefits.list())).some((b) => b.legalEntityId === id),
    ).toBe(false);
  });

  it('keeps People’s name and country on an entity of People’s, and never removes it here', async () => {
    const { uow, asAdmin } = harness();
    const id = randomUUID();
    await uow.run(tenantId, (tx) => tx.entities.save(entity(id, 'people')));
    const saved = await asAdmin((ctx) =>
      saveEntity(ctx, { ...entity(id), name: 'Renamed', country: 'ES', worksCouncil: true }),
    );
    expect(saved.ok).toBe(true);
    const held = await uow.run(tenantId, (tx) => tx.entities.get(id));
    expect(held).toMatchObject({
      name: 'Acme Ltd',
      country: 'GB',
      worksCouncil: true,
      source: 'people',
    });
    const removed = await asAdmin((ctx) => removeEntity(ctx, id));
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.error.code).toBe('FROM_PEOPLE');
  });

  it('keeps a department’s children under it, and a department of People’s as People’s', async () => {
    const { uow, asAdmin } = harness();
    const parent = randomUUID();
    const child = randomUUID();
    expect(
      (
        await asAdmin((ctx) =>
          saveOrgUnit(ctx, { id: parent, name: 'Engineering', parentId: null }),
        )
      ).ok,
    ).toBe(true);
    expect(
      (await asAdmin((ctx) => saveOrgUnit(ctx, { id: child, name: 'Platform', parentId: parent })))
        .ok,
    ).toBe(true);
    const blocked = await asAdmin((ctx) => removeOrgUnit(ctx, parent));
    expect(blocked.ok).toBe(false);
    expect((await asAdmin((ctx) => removeOrgUnit(ctx, child))).ok).toBe(true);
    expect((await asAdmin((ctx) => removeOrgUnit(ctx, parent))).ok).toBe(true);
    const theirs = randomUUID();
    await uow.run(tenantId, (tx) =>
      tx.orgUnits.save({ id: theirs, name: 'Sales', parentId: null, source: 'people' }),
    );
    expect(
      (await asAdmin((ctx) => saveOrgUnit(ctx, { id: theirs, name: 'Renamed', parentId: null })))
        .ok,
    ).toBe(false);
    expect((await asAdmin((ctx) => removeOrgUnit(ctx, theirs))).ok).toBe(false);
  });

  it('keeps the default pipeline while another exists, and a statutory benefit always', async () => {
    const { uow, asAdmin } = harness();
    const stages = (prefix: string) =>
      [
        {
          id: randomUUID(),
          name: `${prefix} applied`,
          candidateName: null,
          category: 'applied' as const,
          automations: [],
        },
        {
          id: randomUUID(),
          name: `${prefix} offer`,
          candidateName: null,
          category: 'offer' as const,
          automations: [],
        },
        {
          id: randomUUID(),
          name: `${prefix} hired`,
          candidateName: null,
          category: 'hired' as const,
          automations: [],
        },
      ] as const;
    const main = randomUUID();
    const other = randomUUID();
    await asAdmin((ctx) =>
      savePipeline(ctx, { id: main, name: 'Standard', isDefault: true, stages: stages('a') }),
    );
    await asAdmin((ctx) =>
      savePipeline(ctx, { id: other, name: 'Interns', isDefault: false, stages: stages('b') }),
    );
    const blocked = await asAdmin((ctx) => removePipeline(ctx, main));
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('DEFAULT');
    expect((await asAdmin((ctx) => removePipeline(ctx, other))).ok).toBe(true);
    expect((await asAdmin((ctx) => removePipeline(ctx, main))).ok).toBe(true);

    const id = randomUUID();
    await asAdmin((ctx) => saveEntity(ctx, entity(id)));
    const statutory = (await uow.run(tenantId, (tx) => tx.benefits.list())).find(
      (b) => b.legalEntityId === id && b.statutory,
    );
    expect(statutory).toBeDefined();
    const kept = await asAdmin((ctx) => removeBenefit(ctx, statutory?.id ?? ''));
    expect(kept.ok).toBe(false);
    if (!kept.ok) expect(kept.error.code).toBe('STATUTORY');
  });
});

describe('questionnaires', () => {
  it('saves a new questionnaire with no works council consent yet, and versions a change', async () => {
    const { asAdmin } = harness();
    const id = randomUUID();
    const question = {
      id: randomUUID(),
      text: 'Do you have the right to work in the UK?',
      kind: 'yes_no' as const,
      required: true,
      options: [],
      points: null,
      knockout: null,
    };
    // As the editor sends it: a name and the questions, nothing about consent or version.
    const first = await asAdmin((ctx) =>
      saveQuestionnaire(ctx, { id, name: 'Right to work', questions: [question] } as never),
    );
    expect(first.ok).toBe(true);
    if (first.ok)
      expect([first.value.version, first.value.worksCouncilConsentVersion]).toEqual([1, null]);
    const second = await asAdmin((ctx) =>
      saveQuestionnaire(ctx, {
        id,
        name: 'Right to work in the UK',
        questions: [question],
      } as never),
    );
    if (second.ok)
      expect([second.value.version, second.value.worksCouncilConsentVersion]).toEqual([2, null]);
  });
});

describe('the company on its careers page', () => {
  it('keeps an uploaded logo by its hash, served by Kithena Jobs', async () => {
    const { deps, asAdmin } = harness();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const done = await asAdmin((ctx) =>
      uploadLogo(ctx, { mediaType: 'image/png', data: png.toString('base64') }),
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const name = done.value.logoUrl.split('/logos/')[1] ?? '';
    expect(done.value.logoUrl.startsWith('https://jobs.example/logos/')).toBe(true);
    expect(name).toMatch(/^[a-f0-9]{64}\.png$/u);
    expect(Buffer.from((await deps.blobs.get(`logos/${name}`)) ?? []).equals(png)).toBe(true);
  });

  it('writes the about from the company’s own site, says where from, and is the AI’s', async () => {
    const seen: string[] = [];
    const { uow, asAdmin } = harness({
      web: {
        read: (host) => {
          seen.push(host);
          return Promise.resolve(
            host === 'meridianfreight.com'
              ? {
                  url: 'https://meridianfreight.com/',
                  text: 'Meridian Freight moves goods by rail.',
                }
              : null,
          );
        },
      },
      model: {
        name: 'test',
        complete: (_tenant, prompt) => {
          expect(JSON.stringify(prompt.context)).toContain('moves goods by rail');
          return Promise.resolve(
            '{"about":"Meridian Freight moves goods by rail across Europe.","sources":[]}',
          );
        },
      },
    });
    await uow.run(tenantId, async (tx) => {
      await tx.settings.set('general', {
        ...DEFAULT_SETTINGS,
        ai: { ...DEFAULT_SETTINGS.ai, writer: true },
      });
    });
    expect(domainsFor('Meridian Freight GmbH')).toContain('meridianfreight.com');
    const done = await asAdmin((ctx) =>
      describeCompany(ctx, { name: 'Meridian Freight', domains: [] }),
    );
    expect(seen[0]).toBe('meridianfreight.com');
    expect(done.ok ? done.value : null).toEqual({
      about: 'Meridian Freight moves goods by rail across Europe.',
      sources: ['https://meridianfreight.com/'],
      searched: false,
    });
  });
});
