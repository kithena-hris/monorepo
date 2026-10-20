import { randomUUID } from 'node:crypto';
import { CalendarDate, Instant, TenantId, type PersonId } from '@kithena/contracts';
import type { Clock } from '@kithena/domain-kit';
import { describe, expect, it } from 'vitest';

import { memoryAccounts, memoryBlobs, memoryUnitOfWork } from '../testing/memory.js';
import {
  accountByToken,
  accountHome,
  addCv,
  removeCv,
  requestAccountCode,
  signInWithCode,
  signInWithGoogle,
  type AccountDeps,
} from './accounts.js';
import { contextOf } from './context.js';
import { candidatePage } from './privacy.js';

const must = <T>(value: T | null | undefined): T => {
  if (value == null) throw new Error('expected a value');
  return value;
};
import type { Deps } from './ports.js';

/** One account across companies (PRD §10.5, extended): a code or Google signs in; a CV library; each company's own page by its token. */

const tenantId = TenantId.parse(randomUUID());
const at = '2026-10-20T09:00:00.000Z';
const clock: Clock = {
  now: () => new Date(at),
  today: () => at.slice(0, 10),
  instant: () => Instant.parse(at),
  date: () => CalendarDate.parse(at.slice(0, 10)),
};

function world(verifyGoogle?: Deps['verifyGoogle']): AccountDeps {
  const uow = memoryUnitOfWork();
  const deps: Deps = {
    uow,
    blobs: memoryBlobs(),
    clock,
    newId: randomUUID,
    jobsOrigin: 'https://jobs.example',
    extractText: () => Promise.resolve(''),
    ...(verifyGoogle === undefined ? {} : { verifyGoogle }),
  };
  return { accounts: memoryAccounts(), deps, at: Instant.parse(at) };
}

describe('a candidate account', () => {
  it('signs in by the emailed code, refuses the wrong one, and keeps a CV library with one default', async () => {
    const d = world();
    const asked = await requestAccountCode(d, 'ada@example.com', 'Ada Lovelace');
    expect(asked.ok).toBe(true);
    const code = asked.ok ? (asked.value.code ?? '') : '';
    expect(code).toMatch(/^\d{6}$/u);
    const wrong = await signInWithCode(d, 'ada@example.com', '000000');
    expect(wrong.ok).toBe(false);
    const session = await signInWithCode(d, 'Ada@Example.com', code);
    expect(session.ok).toBe(true);
    const token = session.ok ? session.value.token : '';
    const account = await accountByToken(d, token);
    expect(account?.name).toBe('Ada Lovelace');

    const pdf = {
      fileName: 'cv.pdf',
      mediaType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    };
    const first = await addCv(d, must(account), pdf, false);
    const second = await addCv(d, must(account), { ...pdf, fileName: 'cv-2.pdf' }, false);
    expect([first.ok, second.ok]).toEqual([true, true]);
    let home = await accountHome(d, must(account));
    expect(home.cvs.map((c) => [c.fileName, c.isDefault])).toEqual([
      ['cv.pdf', true],
      ['cv-2.pdf', false],
    ]);
    expect((await removeCv(d, must(account), first.ok ? first.value.id : '')).ok).toBe(true);
    home = await accountHome(d, must(account));
    expect(home.cvs.map((c) => [c.fileName, c.isDefault])).toEqual([['cv-2.pdf', true]]);
    expect((await addCv(d, must(account), { ...pdf, mediaType: 'image/png' }, false)).ok).toBe(
      false,
    );
  });

  it('lets Google vouch for the address, once it is this site’s client that asked', async () => {
    const d = world((idToken) =>
      Promise.resolve(
        idToken === 'good'
          ? {
              sub: 'g-1',
              email: 'marco@example.com',
              emailVerified: true,
              name: 'Marco',
              picture: null,
            }
          : null,
      ),
    );
    expect((await signInWithGoogle(d, 'bad')).ok).toBe(false);
    const session = await signInWithGoogle(d, 'good');
    expect(session.ok).toBe(true);
    const account = await accountByToken(d, session.ok ? session.value.token : '');
    expect(account).toMatchObject({ email: 'marco@example.com', name: 'Marco', googleSub: 'g-1' });
    // The same person again is the same account.
    const again = await signInWithGoogle(d, 'good');
    const same = await accountByToken(d, again.ok ? again.value.token : '');
    expect(same?.id).toBe(account?.id);
  });

  it('finds the companies that know the address and hands a token each company’s page takes', async () => {
    const d = world();
    const uow = d.deps.uow;
    await uow.run(tenantId, async (tx) => {
      await tx.tenant.register('acme');
      await tx.settings.set('general', { companyName: 'Acme' });
      await tx.candidates.save({
        id: randomUUID(),
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        phone: null,
        cvHash: null,
        personId: null,
        location: null,
        links: [],
        timeZone: null,
        language: 'en',
        tags: [],
        mergedInto: null,
        anonymisedAt: null,
        createdAt: Instant.parse(at),
      });
    });
    const asked = await requestAccountCode(d, 'ada@example.com', 'Ada');
    const session = await signInWithCode(
      d,
      'ada@example.com',
      asked.ok ? (asked.value.code ?? '') : '',
    );
    const account = await accountByToken(d, session.ok ? session.value.token : '');
    const home = await accountHome(d, must(account));
    expect(home.companies.map((c) => [c.slug, c.name])).toEqual([['acme', 'Acme']]);
    const token = home.companies[0]?.token ?? '';
    // The company's own page opens with it, as the magic link would.
    const page = await uow.run(tenantId, async (tx) => {
      const ctx = await contextOf(d.deps, tx, {
        tenantId,
        accountId: 'public',
        personId: null as PersonId | null,
        correlationId: randomUUID(),
      });
      const { createHash } = await import('node:crypto');
      const id = await tx.tokens.candidate(
        createHash('sha256').update(token).digest('hex'),
        ctx.at,
      );
      const candidate = id === null ? null : await tx.candidates.get(id);
      return candidate === null ? null : candidatePage(ctx, candidate);
    });
    expect(page?.name).toBe('Ada Lovelace');
  });
});
