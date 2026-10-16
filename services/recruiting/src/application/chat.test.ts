import { randomBytes, randomUUID } from 'node:crypto';

import { CalendarDate, Instant, TenantId, type PersonId } from '@kithena/contracts';
import type { Clock } from '@kithena/domain-kit';
import { describe, expect, it } from 'vitest';

import { aesSealer } from '../infrastructure/sealer.js';
import { memoryBlobs, memoryUnitOfWork } from '../testing/memory.js';
import { chatDaily } from './chat.js';
import { chatPress } from './chat-press.js';
import { contextOf, type Ctx } from './context.js';
import type { ChatMessage, Deps } from './ports.js';
import { saveRequisition, submitRequisition } from './requisitions.js';
import { DEFAULT_SETTINGS, saveGeneralSettings } from './setup.js';

describe('Recruiting in the chat app (REC-137)', () => {
  it('asks the approver with an Approve that decides as them, once, and nobody else', async () => {
    const uow = memoryUnitOfWork();
    const tenantId = TenantId.parse(randomUUID());
    const sent: ChatMessage[] = [];
    const now = '2026-10-19T09:00:00.000Z';
    const clock: Clock = {
      now: () => new Date(now),
      today: () => now.slice(0, 10),
      instant: () => Instant.parse(now),
      date: () => CalendarDate.parse(now.slice(0, 10)),
    };
    const deps: Deps = {
      uow,
      blobs: memoryBlobs(),
      clock,
      newId: () => randomUUID(),
      jobsOrigin: 'https://jobs.example',
      extractText: () => Promise.resolve(null),
      sealer: aesSealer(randomBytes(32)),
      chat: {
        token: 't',
        appBase: 'https://{slug}.app.example',
        send: (_tenant, m) => {
          sent.push(m);
          return Promise.resolve();
        },
      },
    };
    const people = { ada: randomUUID(), marco: randomUUID(), sofia: randomUUID() };
    const as = <T>(who: keyof typeof people | 'public', fn: (ctx: Ctx) => Promise<T>) =>
      uow.run(tenantId, async (tx) =>
        fn(
          await contextOf(deps, tx, {
            tenantId,
            accountId: who === 'public' ? 'public' : `account-${who}`,
            personId: who === 'public' ? null : (people[who] as PersonId),
            correlationId: randomUUID(),
          }),
        ),
      );
    await uow.run(tenantId, async (tx) => {
      await tx.admins.add('account-ada');
      for (const [who, id] of Object.entries(people))
        await tx.members.upsert(
          {
            personId: id as PersonId,
            accountId: `account-${who}`,
            displayName: who,
            workEmail: `${who}@acme.example`,
            managerPersonId: who === 'marco' ? (people.sofia as PersonId) : null,
            teamKey: null,
            teamName: null,
            locationKey: null,
            legalEntityId: null,
            status: 'active',
          },
          randomUUID(),
          CalendarDate.parse('2026-01-01'),
        );
      await tx.chains.save({
        id: randomUUID(),
        name: 'Manager’s manager',
        appliesTo: 'requisition',
        priority: 1,
        when: {},
        steps: [{ kind: 'managers_manager' }],
      });
    });
    await as('ada', (ctx) =>
      saveGeneralSettings(ctx, { ...DEFAULT_SETTINGS, companyName: 'Acme', companySlug: 'acme' }),
    );
    const id = randomUUID();
    await as('marco', async (ctx) => {
      await saveRequisition(ctx, {
        id,
        title: 'Designer',
        orgUnitId: null,
        hiringManagerId: people.marco,
        legalEntityId: null,
        locationIds: [],
        openings: 1,
        filled: 0,
        targetStart: null,
        reason: 'new_role',
        replacesPersonId: null,
        budget: null,
        justification: 'Growth',
        state: 'draft',
        approved: null,
      });
      expect((await submitRequisition(ctx, id)).ok).toBe(true);
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: { email: 'sofia@acme.example' },
      text: 'A requisition for Designer waits for your approval.',
      links: [
        { label: 'Open in Kithena', url: `https://acme.app.example/recruiting/requisitions/${id}` },
      ],
    });
    const value = sent[0]?.approve ?? '';
    expect(value.startsWith('acme.')).toBe(true);

    // Pressed: decided as Sofia, with the screen's rules.
    expect(await as('public', (ctx) => chatPress(ctx, value))).toEqual({
      ok: true,
      value: { text: 'Approved, 2026-10-19.' },
    });
    expect(await as('ada', async (ctx) => (await ctx.tx.requisitions.get(id))?.state)).toBe(
      'approved',
    );
    // Pressed again: nothing waits on her now.
    const again = await as('public', (ctx) => chatPress(ctx, value));
    expect(again.ok && again.value.text.startsWith('Not approved')).toBe(true);
    // A value Recruiting did not seal decides nothing.
    const forged = await as('public', (ctx) => chatPress(ctx, `acme.${value.slice(6, -4)}AAAA`));
    expect(forged.ok).toBe(false);
  });

  it('posts yesterday’s new applicants to a job’s channel and reminds an owed scorecard', async () => {
    const sent: ChatMessage[] = [];
    const settings: Record<string, unknown> = { 'chat-channel:j1': 'C0123456789' };
    const ctx = {
      deps: {
        chat: {
          appBase: 'https://{slug}.app.example',
          send: (_t: string, m: ChatMessage) => {
            sent.push(m);
            return Promise.resolve();
          },
        },
      },
      caller: { tenantId: 't' },
      today: '2026-10-19',
      tx: {
        settings: {
          get: (key: string) =>
            Promise.resolve(
              key === 'general'
                ? { ...DEFAULT_SETTINGS, companyName: 'Acme', companySlug: 'acme' }
                : (settings[key] ?? null),
            ),
        },
        jobs: {
          list: () =>
            Promise.resolve([
              { id: 'j1', title: 'Driver', state: 'open' },
              { id: 'j2', title: 'Closed', state: 'closed' },
            ]),
        },
        applications: {
          forJob: () =>
            Promise.resolve([
              { createdAt: '2026-10-18T10:00:00.000Z' },
              { createdAt: '2026-10-18T23:59:00.000Z' },
              { createdAt: '2026-10-19T08:00:00.000Z' },
            ]),
        },
        interviews: {
          startingBetween: () =>
            Promise.resolve([
              { id: 'i1', title: 'Final', state: 'completed', interviewerIds: ['p1', 'p2'] },
            ]),
          scorecards: () =>
            Promise.resolve([{ interviewerId: 'p1', submittedAt: '2026-10-18T15:00:00Z' }]),
        },
        members: { get: (id: string) => Promise.resolve({ workEmail: `${id}@acme.example` }) },
      },
    } as unknown as Ctx;
    await chatDaily(ctx);
    expect(sent).toEqual([
      {
        to: { channel: 'C0123456789' },
        text: '2 new applicants for Driver yesterday.',
        links: [{ label: 'Review them', url: 'https://acme.app.example/recruiting/jobs/j1' }],
      },
      {
        to: { email: 'p2@acme.example' },
        text: 'Your scorecard for Final yesterday is still to do.',
        links: [{ label: 'Fill it in', url: 'https://acme.app.example/recruiting/interviews/i1' }],
      },
    ]);
  });
});
