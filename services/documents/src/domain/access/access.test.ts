import { describe, expect, it } from 'vitest';
import type { CalendarDate, PersonId } from '@kithena/contracts';

import {
  canDelete,
  canDownload,
  canEdit,
  canOpen,
  canSetConfidential,
  canShare,
  type AccessFacts,
  type Viewer,
} from './access.js';

const today = '2026-10-12' as CalendarDate;
const ADAM = {
  accountId: 'acc-adam',
  personId: 'p-adam' as PersonId,
  teamKey: 'platform',
  hr: false,
};
const MARCO = {
  accountId: 'acc-marco',
  personId: 'p-marco' as PersonId,
  teamKey: 'platform',
  hr: false,
};
const OMAR = { accountId: 'acc-omar', personId: 'p-omar' as PersonId, teamKey: 'data', hr: false };
const ADA = { accountId: 'acc-ada', personId: 'p-ada' as PersonId, teamKey: 'people', hr: true };

const base: AccessFacts = {
  ownerAccount: 'acc-adam',
  subjectPersonId: null,
  filed: false,
  audience: null,
  level: 'private',
  confidential: false,
  confidentialBy: null,
  grants: [],
  deleted: false,
};

const contract: AccessFacts = {
  ...base,
  ownerAccount: 'acc-ada',
  subjectPersonId: 'p-adam' as PersonId,
  filed: true,
  audience: 'subject',
  confidential: true,
  confidentialBy: 'type',
};

const opens = (doc: AccessFacts, who: Viewer) => canOpen(doc, who, today);

describe('who opens a document (PRD §6.2)', () => {
  it('a private document of your own: only you', () => {
    expect(opens(base, ADAM)).toBe(true);
    expect(opens(base, MARCO)).toBe(false);
  });

  it('HR never opens somebody’s own private document', () => {
    expect(opens(base, ADA)).toBe(false);
  });

  it('a contract about Adam: Adam and HR, nobody else', () => {
    expect(opens(contract, ADAM)).toBe(true);
    expect(opens(contract, ADA)).toBe(true);
    expect(opens(contract, MARCO)).toBe(false);
  });

  it('a company policy for everyone opens for everyone', () => {
    const policy = { ...base, ownerAccount: 'acc-ada', filed: true, audience: 'everyone' as const };
    expect(opens(policy, OMAR)).toBe(true);
  });

  it('a filed HR-only document opens for HR, and for the person it is about', () => {
    const sick = { ...contract, audience: 'hr' as const };
    expect(opens(sick, ADA)).toBe(true);
    expect(opens(sick, ADAM)).toBe(true);
    expect(opens(sick, MARCO)).toBe(false);
  });

  it('a share reaches a person, a team, or everyone, until it ends', () => {
    const shared = (grants: AccessFacts['grants']): AccessFacts => ({
      ...base,
      level: 'shared',
      grants,
    });
    const toMarco = shared([
      { grantee: { kind: 'member', personId: 'p-marco' }, permission: 'view', endsOn: null },
    ]);
    expect(opens(toMarco, MARCO)).toBe(true);
    expect(opens(toMarco, OMAR)).toBe(false);
    const toTeam = shared([
      { grantee: { kind: 'team', teamKey: 'platform' }, permission: 'view', endsOn: null },
    ]);
    expect(opens(toTeam, MARCO)).toBe(true);
    expect(opens(toTeam, OMAR)).toBe(false);
    const toAll = shared([{ grantee: { kind: 'everyone' }, permission: 'view', endsOn: null }]);
    expect(opens(toAll, OMAR)).toBe(true);
    const ended = shared([
      {
        grantee: { kind: 'member', personId: 'p-marco' },
        permission: 'view',
        endsOn: '2026-10-11' as CalendarDate,
      },
    ]);
    expect(opens(ended, MARCO)).toBe(false);
    const lastDay = shared([
      { grantee: { kind: 'member', personId: 'p-marco' }, permission: 'view', endsOn: today },
    ]);
    expect(opens(lastDay, MARCO)).toBe(true);
  });

  it('a private document ignores grants left behind', () => {
    const stale: AccessFacts = {
      ...base,
      grants: [{ grantee: { kind: 'everyone' }, permission: 'view', endsOn: null }],
    };
    expect(opens(stale, OMAR)).toBe(false);
  });

  it('a deleted document opens only for its owner and HR, to restore it', () => {
    const gone = { ...contract, deleted: true };
    expect(opens(gone, ADA)).toBe(true);
    expect(opens(gone, ADAM)).toBe(false);
    expect(opens({ ...base, deleted: true }, ADAM)).toBe(true);
  });
});

describe('editing, sharing and deleting', () => {
  it('an edit grant edits but does not share', () => {
    const doc: AccessFacts = {
      ...base,
      level: 'shared',
      grants: [
        { grantee: { kind: 'member', personId: 'p-marco' }, permission: 'edit', endsOn: null },
      ],
    };
    expect(canEdit(doc, MARCO, today)).toBe(true);
    expect(canShare(doc, MARCO).ok).toBe(false);
    expect(canShare(doc, ADAM).ok).toBe(true);
  });

  it('documents about you are not yours to reshare or delete', () => {
    expect(canShare(contract, ADAM)).toMatchObject({ ok: false, error: { code: 'ABOUT_YOU' } });
    expect(canDelete(contract, ADAM).ok).toBe(false);
    expect(canShare(contract, ADA).ok).toBe(true);
    expect(canDelete(contract, ADA).ok).toBe(true);
  });

  it('HR does not share or delete somebody’s own document', () => {
    expect(canShare(base, ADA).ok).toBe(false);
    expect(canDelete(base, ADA).ok).toBe(false);
  });
});

describe('confidential', () => {
  it('the person it is about downloads it; others who open it do not', () => {
    expect(canDownload(contract, ADAM, today)).toBe(true);
    expect(canDownload(contract, ADA, today)).toBe(true);
    const shared: AccessFacts = {
      ...base,
      level: 'shared',
      confidential: true,
      confidentialBy: 'owner',
      grants: [
        { grantee: { kind: 'member', personId: 'p-marco' }, permission: 'view', endsOn: null },
      ],
    };
    expect(canDownload(shared, MARCO, today)).toBe(false);
    expect(canDownload(shared, ADAM, today)).toBe(true);
  });

  it('an owner turns it on and, when they set it, off', () => {
    expect(canSetConfidential(base, ADAM, true).ok).toBe(true);
    const own = { ...base, confidential: true, confidentialBy: 'owner' as const };
    expect(canSetConfidential(own, ADAM, false).ok).toBe(true);
  });

  it('only HR lowers what HR or the type set', () => {
    const byHr = { ...base, confidential: true, confidentialBy: 'hr' as const };
    expect(canSetConfidential(byHr, ADAM, false)).toMatchObject({
      ok: false,
      error: { code: 'HR_PROTECTED' },
    });
    expect(canSetConfidential(contract, ADA, false).ok).toBe(true);
  });

  it('nobody else touches it', () => {
    expect(canSetConfidential(base, MARCO, true).ok).toBe(false);
  });
});
