import type { DocumentData, LibraryData, PersonFileData, Row, SettingsData } from '../types';

/** Acme's documents as the design draws them (B1, B2, B3, D1, S2), for the screens' tests. */

const adam = { personId: 'p-adam', name: 'Adam Novak', teamName: 'Platform' };
const mei = { personId: 'p-mei', name: 'Mei Tanaka', teamName: 'Data' };

export const row = (over: Partial<Row> = {}): Row => ({
  id: 'd-add',
  title: 'Remote-work addendum',
  kind: 'Contract',
  typeKey: 'contract_addendum',
  typeName: 'Contract addendum',
  level: 'private',
  confidential: true,
  everyone: false,
  who: { label: 'You and HR', people: [] },
  subject: adam,
  pages: 3,
  updatedAt: '2026-10-12T09:00:00.000Z',
  expiresOn: null,
  status: null,
  mine: false,
  aboutMe: true,
  deletedAt: null,
  sectionIds: [],
  ...over,
});

export function adamLibrary(over: Partial<LibraryData> = {}): LibraryData {
  return {
    viewer: { hr: false, name: 'Adam Novak', personId: 'p-adam', askAfterUpload: true },
    show: 'all',
    q: '',
    queue: null,
    deleted: false,
    sections: [{ id: 's-mort', kind: 'personal', name: 'Mortgage', count: 1 }],
    needsYou: [
      {
        id: 'r-1',
        kind: 'request',
        title: 'Add your Bank details form',
        detail: 'We need your bank account before payroll.',
        dueOn: '2026-10-25',
        documentId: null,
        typeKey: 'bank_details',
      },
    ],
    tiles: [],
    queueRows: [],
    rows: [
      row(),
      row({
        id: 'd-mort',
        title: 'Mortgage pre-approval',
        kind: 'Personal',
        typeKey: null,
        typeName: null,
        confidential: false,
        who: { label: 'Only you', people: [] },
        subject: null,
        pages: 2,
        mine: true,
        aboutMe: false,
        sectionIds: ['s-mort'],
      }),
      row({
        id: 'd-hb',
        title: 'Employee handbook 2026',
        kind: 'Policy',
        typeKey: 'policy',
        typeName: 'Policy',
        confidential: false,
        everyone: true,
        who: { label: 'Everyone', people: [] },
        subject: null,
        pages: 42,
        aboutMe: false,
      }),
    ],
    total: 3,
    types: [],
    people: [adam, mei],
    ...over,
  };
}

export function adaLibrary(): LibraryData {
  return adamLibrary({
    viewer: { hr: true, name: 'Ada Lovelace', personId: 'p-ada', askAfterUpload: true },
    needsYou: [],
    queue: 'expiring',
    tiles: [
      { key: 'to_sign', label: 'To sign', count: 0, detail: 'Nothing waiting' },
      { key: 'expiring', label: 'Expiring', count: 1, detail: 'Work permit · Omar first' },
      { key: 'missing', label: 'Missing', count: 9, detail: 'Mei and Yuki' },
      { key: 'to_delete', label: 'To delete', count: 0, detail: 'Nothing due' },
    ],
    queueRows: [
      {
        id: 'd-permit',
        title: 'Work permit · Omar',
        kind: 'Permit',
        person: { personId: 'p-omar', name: 'Omar Haddad', teamName: 'Data' },
        detail: 'In 52 days · 2026-12-02',
        dueOn: '2026-12-02',
        tone: 'warning',
        documentId: 'd-permit',
        requestId: null,
        typeKey: 'work_permit',
        action: 'ask',
      },
    ],
    types: [
      {
        key: 'work_permit',
        name: 'Work permit',
        kind: 'Permit',
        filedTo: 'person',
        confidential: true,
      },
    ],
  });
}

export function adamDocument(): DocumentData {
  const version = {
    n: 1,
    fileName: 'addendum.pdf',
    mediaType: 'application/pdf',
    size: 1200,
    pages: 3,
    note: null,
    uploadedAt: '2026-10-12T09:00:00.000Z',
    uploadedBy: 'Ada Lovelace',
  };
  return {
    document: {
      row: row(),
      owner: 'Ada Lovelace',
      versions: [version],
      current: version,
      grants: [],
      may: {
        edit: false,
        share: false,
        download: true,
        delete: false,
        protect: false,
        unprotect: false,
      },
      confidentialBy: 'type',
      views: [],
      activity: [],
      accessRequests: [],
      held: false,
      people: [],
    },
    closed: null,
  };
}

export const closedDocument = (): DocumentData => ({
  document: null,
  closed: { owner: 'Ada Lovelace', requested: false },
});

export function meiFile(): PersonFileData {
  return {
    person: mei,
    jobLine: 'Data · starts 2026-11-01',
    hireDate: '2026-11-01',
    checklist: [
      {
        typeKey: 'employment_contract',
        name: 'Employment contract',
        kind: 'Contract',
        state: 'have',
        detail: 'In their file',
        documentId: 'd-c',
        requestId: null,
        dueOn: '2026-11-01',
        action: 'view',
      },
      {
        typeKey: 'bank_details',
        name: 'Bank details form',
        kind: 'Form',
        state: 'asked',
        detail: 'Asked 2026-10-07',
        documentId: null,
        requestId: 'r-b',
        dueOn: '2026-11-01',
        action: 'remind',
      },
      {
        typeKey: 'tax_form',
        name: 'Tax form (Modelo 145)',
        kind: 'Form',
        state: 'missing',
        detail: 'Not asked yet',
        documentId: null,
        requestId: null,
        dueOn: '2026-11-01',
        action: 'ask',
      },
    ],
    have: 1,
    of: 3,
    rows: [row({ id: 'd-c', title: 'Employment contract', subject: mei, aboutMe: false })],
    hr: true,
    types: [
      {
        key: 'tax_form',
        name: 'Tax form (Modelo 145)',
        kind: 'Form',
        filedTo: 'person',
        confidential: true,
      },
    ],
  };
}

export function adaSettings(): SettingsData {
  return {
    types: [
      {
        key: 'employment_contract',
        name: 'Employment contract',
        kind: 'Contract',
        filedTo: 'person',
        audience: 'subject',
        confidential: true,
        medical: false,
        signers: ['subject', 'hr'],
        acknowledge: false,
        requiredFor: 'new_starters',
        requiredBy: 0,
        expiryReminders: [],
        retention: { kind: 'after_leaving', years: 4 },
        aiReads: [],
        aiEnabled: true,
        archived: false,
        used: 118,
        retentionWords: '4 years after they leave',
      },
    ],
    sections: [],
    access: {
      askAfterUpload: true,
      peopleMayTurnOffQuestion: true,
      everyoneShare: 'hr',
      companyLinks: true,
      outsideSharing: false,
      watermark: true,
      blockDownload: true,
      personalSections: true,
    },
    holds: [
      {
        id: 'h-1',
        name: 'Case 0412',
        setBy: 'Ada Lovelace',
        setAt: '2026-09-01T09:00:00.000Z',
        count: 3,
      },
    ],
    hr: true,
  };
}
