import { describe, expect, it } from 'vitest';
import type { CalendarDate, DocumentId, Instant, PersonId } from '@kithena/contracts';

import {
  addVersion,
  checkFile,
  fileDocument,
  makePrivate,
  remove,
  restore,
  setConfidential,
  share,
  trashEnds,
  type FileInput,
  type Version,
} from './document.js';

const at = '2026-10-12T09:00:00.000Z' as Instant;
const v = (n: number): Version => ({
  n,
  blobKey: `k${n}`,
  fileName: 'addendum.pdf',
  mediaType: 'application/pdf',
  size: 1200,
  pages: 3,
  checksum: 'a'.repeat(64),
  note: null,
  uploadedAt: at,
  uploadedBy: 'acc-ada',
});
const input: FileInput = {
  id: '00000000-0000-4000-8000-000000000001' as DocumentId,
  title: '  Remote-work addendum ',
  typeKey: null,
  kind: 'Personal',
  ownerAccount: 'acc-adam',
  subjectPersonId: null,
  confidentialByType: false,
  expiresOn: null,
  version: v(1),
  at,
};
const filed = () => {
  const r = fileDocument(input);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const marco = {
  grantee: { kind: 'member' as const, personId: 'p-marco' },
  permission: 'view' as const,
  endsOn: null,
};

describe('filing (PRD §8.1)', () => {
  it('starts Private, at version 1, with a trimmed name', () => {
    expect(filed()).toMatchObject({
      title: 'Remote-work addendum',
      level: 'private',
      currentVersion: 1,
    });
  });

  it('is Confidential when its type says so, and remembers the type set it', () => {
    const r = fileDocument({
      ...input,
      confidentialByType: true,
      subjectPersonId: 'p-adam' as PersonId,
    });
    expect(r).toMatchObject({ ok: true, value: { confidential: true, confidentialBy: 'type' } });
  });

  it('refuses an empty name', () => {
    expect(fileDocument({ ...input, title: '  ' }).ok).toBe(false);
  });

  it('takes PDFs, images and Office files up to 100 MB', () => {
    expect(checkFile({ mediaType: 'application/pdf', size: 10 }).ok).toBe(true);
    expect(checkFile({ mediaType: 'application/x-msdownload', size: 10 }).ok).toBe(false);
    expect(checkFile({ mediaType: 'application/pdf', size: 0 }).ok).toBe(false);
    expect(checkFile({ mediaType: 'image/png', size: 101 * 1024 * 1024 }).ok).toBe(false);
  });
});

describe('versions (PRD §8.2)', () => {
  it('adds the next version only', () => {
    expect(addVersion(filed(), v(2))).toMatchObject({ ok: true, value: { currentVersion: 2 } });
    expect(addVersion(filed(), v(3))).toMatchObject({
      ok: false,
      error: { code: 'VERSION_CONFLICT' },
    });
  });
});

describe('sharing (PRD §6.3)', () => {
  it('a grant makes it Shared, none makes it Private', () => {
    const shared = share(filed(), [marco]);
    expect(shared).toMatchObject({ ok: true, value: { level: 'shared' } });
    if (!shared.ok) return;
    expect(makePrivate(shared.value)).toMatchObject({
      ok: true,
      value: { level: 'private', grants: [] },
    });
  });

  it('refuses somebody listed twice', () => {
    expect(share(filed(), [marco, marco]).ok).toBe(false);
  });

  it('Confidential records who set it, and clears it when lowered', () => {
    const on = setConfidential(filed(), true, 'owner');
    expect(on).toMatchObject({ ok: true, value: { confidential: true, confidentialBy: 'owner' } });
    if (!on.ok) return;
    expect(setConfidential(on.value, false, 'owner')).toMatchObject({
      ok: true,
      value: { confidential: false, confidentialBy: null },
    });
  });
});

describe('deleting (PRD §12.3)', () => {
  it('goes to Deleted, for 30 days, unless a hold keeps it', () => {
    const gone = remove(filed(), at, false);
    expect(gone).toMatchObject({ ok: true, value: { deletedAt: at } });
    expect(remove(filed(), at, true)).toMatchObject({ ok: false, error: { code: 'LEGAL_HOLD' } });
    expect(trashEnds(at)).toBe('2026-11-11' as CalendarDate);
    if (!gone.ok) return;
    expect(share(gone.value, [marco]).ok).toBe(false);
    expect(restore(gone.value)).toMatchObject({ ok: true, value: { deletedAt: null } });
  });
});
