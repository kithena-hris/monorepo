import { err, failure, ok, type Result } from '@kithena/domain-kit';
import {
  DocumentTypeDefinition,
  type CalendarDate,
  type DocumentTypeKey,
  type RetentionRule,
} from '@kithena/contracts';

import { addDays, addYears } from '../dates.js';

/**
 * Document types (PRD §12.1): what HR sets up once, so filing, access,
 * signatures, checklists, expiry and retention follow from the type and not
 * from whoever uploads.
 */

export type DocumentType = DocumentTypeDefinition;

/** The rules a definition's parts must keep together; Zod has checked each part. */
export function checkType(input: unknown): Result<DocumentType> {
  const parsed = DocumentTypeDefinition.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(
      failure('BAD_TYPE', issue?.message ?? 'Not a document type', issue?.path.map(String)),
    );
  }
  const t = parsed.data;
  if (t.medical && (!t.confidential || t.audience !== 'hr')) {
    return err(failure('MEDICAL_IS_HR_ONLY', 'Medical documents are Confidential and HR only'));
  }
  if (t.requiredFor !== null && t.filedTo !== 'person') {
    return err(
      failure('REQUIRED_NEEDS_PERSON', 'Only a type filed to each person can be required'),
    );
  }
  if (t.filedTo === 'company' && t.signers.includes('subject')) {
    return err(failure('NOBODY_TO_SIGN', 'A company document is about nobody who could sign it'));
  }
  if (t.medical && t.aiReads.length > 0) {
    return err(failure('MEDICAL_DATES_ONLY', 'Kithena reads dates only on medical documents'));
  }
  return ok(t);
}

/** "4 years after they leave" — the rule as S2 and S6 say it. */
export function retentionWords(rule: RetentionRule): string {
  const years = (n: number): string => `${String(n)} year${n === 1 ? '' : 's'}`;
  switch (rule.kind) {
    case 'after_leaving':
      return `${years(rule.years)} after they leave`;
    case 'until_leaving':
      return rule.plusYears === 0
        ? 'Until they leave'
        : `Until they leave, plus ${years(rule.plusYears)}`;
    case 'years':
      return years(rule.years);
    case 'days':
      return `${String(rule.days)} days`;
    case 'forever':
      return 'Every version, forever';
  }
}

/**
 * When a document's retention ends (PRD §12.3), or null when it does not end
 * yet: kept forever, or tied to a leaving date nobody has.
 */
export function retentionEnds(
  rule: RetentionRule,
  filedOn: CalendarDate,
  leftOn: CalendarDate | null,
): CalendarDate | null {
  switch (rule.kind) {
    case 'after_leaving':
      return leftOn === null ? null : addYears(leftOn, rule.years);
    case 'until_leaving':
      return leftOn === null ? null : addYears(leftOn, rule.plusYears);
    case 'years':
      return addYears(filedOn, rule.years);
    case 'days':
      return addDays(filedOn, rule.days);
    case 'forever':
      return null;
  }
}

const key = (k: string) => k as DocumentTypeKey;

/** The fourteen types a company starts with (S2, MS2): five required for new starters. */
export const SEEDED_TYPES: readonly DocumentType[] = [
  {
    key: key('employment_contract'),
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
    aiReads: ['start date', 'job title', 'salary', 'probation', 'notice period'],
    aiEnabled: true,
  },
  {
    key: key('id_document'),
    name: 'ID or passport',
    kind: 'ID',
    filedTo: 'person',
    audience: 'subject',
    confidential: true,
    medical: false,
    signers: [],
    acknowledge: false,
    requiredFor: 'new_starters',
    requiredBy: 0,
    expiryReminders: [60],
    retention: { kind: 'until_leaving', plusYears: 1 },
    aiReads: ['document number', 'nationality', 'date of birth', 'expiry date'],
    aiEnabled: true,
  },
  {
    key: key('nda'),
    name: 'NDA',
    kind: 'Contract',
    filedTo: 'person',
    audience: 'subject',
    confidential: true,
    medical: false,
    signers: ['subject'],
    acknowledge: false,
    requiredFor: 'new_starters',
    requiredBy: 0,
    expiryReminders: [],
    retention: { kind: 'after_leaving', years: 4 },
    aiReads: [],
    aiEnabled: true,
  },
  {
    key: key('bank_details'),
    name: 'Bank details form',
    kind: 'Form',
    filedTo: 'person',
    audience: 'subject',
    confidential: true,
    medical: false,
    signers: [],
    acknowledge: false,
    requiredFor: 'new_starters',
    requiredBy: 0,
    expiryReminders: [],
    retention: { kind: 'until_leaving', plusYears: 1 },
    aiReads: ['account number'],
    aiEnabled: true,
  },
  {
    key: key('tax_form'),
    name: 'Tax form (Modelo 145)',
    kind: 'Form',
    filedTo: 'person',
    audience: 'subject',
    confidential: true,
    medical: false,
    signers: [],
    acknowledge: false,
    requiredFor: 'new_starters',
    requiredBy: 0,
    expiryReminders: [],
    retention: { kind: 'after_leaving', years: 4 },
    aiReads: [],
    aiEnabled: true,
  },
  {
    key: key('work_permit'),
    name: 'Work permit',
    kind: 'Permit',
    filedTo: 'person',
    audience: 'subject',
    confidential: true,
    medical: false,
    signers: [],
    acknowledge: false,
    requiredFor: null,
    requiredBy: 0,
    expiryReminders: [60, 14],
    retention: { kind: 'until_leaving', plusYears: 1 },
    aiReads: ['expiry date'],
    aiEnabled: true,
  },
  {
    key: key('payslip'),
    name: 'Payslip',
    kind: 'Payslip',
    filedTo: 'person',
    audience: 'subject',
    confidential: true,
    medical: false,
    signers: [],
    acknowledge: false,
    requiredFor: null,
    requiredBy: 0,
    expiryReminders: [],
    retention: { kind: 'years', years: 5 },
    aiReads: ['net pay', 'pay date'],
    aiEnabled: true,
  },
  {
    key: key('sick_note'),
    name: 'Sick note',
    kind: 'Medical',
    filedTo: 'person',
    audience: 'hr',
    confidential: true,
    medical: true,
    signers: [],
    acknowledge: false,
    requiredFor: null,
    requiredBy: 0,
    expiryReminders: [],
    retention: { kind: 'years', years: 4 },
    aiReads: [],
    aiEnabled: true,
  },
  {
    key: key('contract_addendum'),
    name: 'Contract addendum',
    kind: 'Contract',
    filedTo: 'person',
    audience: 'subject',
    confidential: true,
    medical: false,
    signers: ['subject', 'hr'],
    acknowledge: false,
    requiredFor: null,
    requiredBy: 0,
    expiryReminders: [],
    retention: { kind: 'after_leaving', years: 4 },
    aiReads: ['start date'],
    aiEnabled: true,
  },
  {
    key: key('letter'),
    name: 'Letter',
    kind: 'Letter',
    filedTo: 'person',
    audience: 'subject',
    confidential: true,
    medical: false,
    signers: [],
    acknowledge: false,
    requiredFor: null,
    requiredBy: 0,
    expiryReminders: [],
    retention: { kind: 'after_leaving', years: 4 },
    aiReads: ['last day'],
    aiEnabled: true,
  },
  {
    key: key('certificate'),
    name: 'Certificate or licence',
    kind: 'ID',
    filedTo: 'person',
    audience: 'subject',
    confidential: false,
    medical: false,
    signers: [],
    acknowledge: false,
    requiredFor: null,
    requiredBy: 0,
    expiryReminders: [60],
    retention: { kind: 'until_leaving', plusYears: 1 },
    aiReads: ['expiry date'],
    aiEnabled: true,
  },
  {
    key: key('policy'),
    name: 'Policy',
    kind: 'Policy',
    filedTo: 'company',
    audience: 'everyone',
    confidential: false,
    medical: false,
    signers: [],
    acknowledge: true,
    requiredFor: null,
    requiredBy: 0,
    expiryReminders: [],
    retention: { kind: 'forever' },
    aiReads: [],
    aiEnabled: true,
  },
  {
    key: key('people_export'),
    name: 'Export from People',
    kind: 'Sheet',
    filedTo: 'company',
    audience: 'hr',
    confidential: true,
    medical: false,
    signers: [],
    acknowledge: false,
    requiredFor: null,
    requiredBy: 0,
    expiryReminders: [],
    retention: { kind: 'days', days: 90 },
    aiReads: [],
    // Read like any other (decided 2026-10-14): every name, email, number and
    // address in it is a stand-in before a model sees it (PRD §14.1).
    aiEnabled: true,
  },
  {
    key: key('template'),
    name: 'Letter template',
    kind: 'Template',
    filedTo: 'company',
    audience: 'hr',
    confidential: false,
    medical: false,
    signers: [],
    acknowledge: false,
    requiredFor: null,
    requiredBy: 0,
    expiryReminders: [],
    retention: { kind: 'forever' },
    aiReads: [],
    aiEnabled: true,
  },
];
