import { describe, expect, it } from 'vitest';
import { AttributeDefinition, type AttributeDefinitionInput } from '@kithena/contracts';

import type { ViewerRelations } from './field-access.js';
import { mayViewAs, specialCategoryVisible, writable, type ViewAsAsker } from './view-as.js';

/**
 * Viewing as an employee (decided 2026-09-29): a People administrator sees
 * exactly what one employee sees, and changes nothing.
 */

const admin: ViewAsAsker = { accountId: 'admin', administrator: true, support: false, viewing: false };
const target = { accountId: 'emp', administrator: false, active: true };

describe('who may view as whom', () => {
  it('lets a People administrator view as an employee', () => {
    expect(mayViewAs(admin, target)).toEqual({ ok: true, value: undefined });
  });

  it('refuses anybody who is not a People administrator, HR included', () => {
    expect(mayViewAs({ ...admin, administrator: false }, target)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('refuses Kithena support, which is an administrator by its session only', () => {
    expect(mayViewAs({ ...admin, support: true }, target)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('refuses from inside another view', () => {
    expect(mayViewAs({ ...admin, viewing: true }, target)).toMatchObject({
      ok: false,
      error: { code: 'VIEW_ONLY' },
    });
  });

  it('never views as another administrator, nor as oneself', () => {
    expect(mayViewAs(admin, { ...target, administrator: true })).toMatchObject({
      ok: false,
      error: { code: 'VIEW_AS_ADMINISTRATOR' },
    });
    expect(mayViewAs(admin, { ...target, accountId: 'admin' })).toMatchObject({
      ok: false,
      error: { code: 'VIEW_AS_SELF' },
    });
  });

  it('needs somebody who can sign in: an account, and access that has not ended', () => {
    expect(mayViewAs(admin, { ...target, accountId: null })).toMatchObject({
      ok: false,
      error: { code: 'VIEW_AS_NO_ACCOUNT' },
    });
    expect(mayViewAs(admin, { ...target, active: false })).toMatchObject({
      ok: false,
      error: { code: 'VIEW_AS_NO_ACCOUNT' },
    });
  });
});

describe('while viewing', () => {
  it('nothing is writable', () => {
    expect(writable({ viewing: { by: 'admin' } })).toMatchObject({
      ok: false,
      error: { code: 'VIEW_ONLY' },
    });
    expect(writable({})).toEqual({ ok: true, value: undefined });
  });
});

const define = (over: Partial<AttributeDefinitionInput> & { key: string }) =>
  AttributeDefinition.parse({
    sectionKey: 'personal',
    label: { default: over.key },
    dataType: 'text',
    typeConfig: { kind: 'text' },
    requiredness: { mode: 'never' },
    ownership: ['employee'],
    visibility: ['self', 'hr'],
    collectAt: 'hr_only',
    classification: {
      classification: 'internal',
      piiKind: 'none',
      exportable: true,
      aiEligible: true,
    },
    classificationSource: 'human',
    origin: 'tenant',
    ...over,
  });

const special = (key: string, visibility: AttributeDefinitionInput['visibility']) =>
  define({
    key,
    visibility,
    classification: {
      classification: 'special-category',
      piiKind: 'health',
      exportable: false,
      aiEligible: false,
    },
  });

const none: ViewerRelations = {
  isSelf: false,
  isManager: false,
  isInManagerChain: false,
  isHr: false,
  isFinance: false,
  isAdmin: false,
};
const self: ViewerRelations = { ...none, isSelf: true };

describe('whether special-category data was visible', () => {
  const disability = special('disability', ['self', 'hr']);
  const ethnicity = special('ethnicity', []);
  const title = define({ key: 'job_title', visibility: ['self', 'directory'] });

  it('is when the employee reads one of theirs that has a value', () => {
    expect(
      specialCategoryVisible([title, disability], { disability: 'yes' }, self, none),
    ).toBe(true);
  });

  it('is not for an empty value, one nobody reads, or none at all', () => {
    expect(specialCategoryVisible([title, disability], {}, self, none)).toBe(false);
    expect(specialCategoryVisible([ethnicity], { ethnicity: 'x' }, self, none)).toBe(false);
    expect(specialCategoryVisible([title], { job_title: 'Engineer' }, self, none)).toBe(false);
  });

  it('is when their role reads it on others, filled in or not here', () => {
    expect(specialCategoryVisible([disability], {}, self, { ...none, isHr: true })).toBe(true);
    const managers = special('sick_notes', ['manager']);
    expect(specialCategoryVisible([managers], {}, self, { ...none, isManager: true })).toBe(true);
    expect(specialCategoryVisible([managers], {}, self, none)).toBe(false);
  });
});
