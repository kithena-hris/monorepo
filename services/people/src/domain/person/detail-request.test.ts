import { describe, expect, it } from 'vitest';
import type { AttributeDefinition } from '@kithena/contracts';

import type { ViewerRelations } from '../access/field-access.js';
import { askable, requestable, REQUEST_AGAIN_AFTER_MS } from './detail-request.js';

const nobody: ViewerRelations = {
  isSelf: false,
  isManager: false,
  isInManagerChain: false,
  isHr: false,
  isFinance: false,
  isAdmin: false,
};
const hr = { ...nobody, isHr: true };
const manager = { ...nobody, isManager: true };

const field = (key: string, over: Partial<AttributeDefinition> = {}) =>
  ({
    key,
    ownership: ['employee', 'hr'],
    visibility: ['self', 'manager', 'hr'],
    visibilityRules: [],
    deprecatedAt: null,
    encrypted: false,
    ...over,
  }) as unknown as AttributeDefinition;

const phone = field('work_phone');
const number = field('employee_number', { ownership: ['hr'] });
const secret = field('marital_status', { visibility: ['self', 'hr'] });
const all = [phone, number, secret];

describe('requestable', () => {
  it('lets HR and a manager ask the employee for a field the employee fills in', () => {
    expect(askable(phone, hr)).toBe(true);
    expect(askable(phone, manager)).toBe(true);
    expect(requestable(all, ['work_phone'], hr).ok).toBe(true);
  });

  it('never asks the employee for what only HR fills in', () => {
    expect(askable(number, hr)).toBe(false);
    const asked = requestable(all, ['employee_number'], hr);
    expect(asked.ok).toBe(false);
    if (!asked.ok) expect(asked.error.code).toBe('FIELD_NOT_REQUESTABLE');
  });

  it('never asks for a field the one asking may not read', () => {
    expect(askable(secret, manager)).toBe(false);
    expect(requestable(all, ['marital_status'], manager).ok).toBe(false);
  });

  it('is nobody’s to ask of themselves, and a colleague’s not at all', () => {
    const self = requestable(all, ['work_phone'], { ...hr, isSelf: true });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.error.code).toBe('FORBIDDEN');
    expect(requestable(all, ['work_phone'], nobody).ok).toBe(false);
  });

  it('refuses an unknown key, no keys and too many', () => {
    expect(requestable(all, ['nope'], hr).ok).toBe(false);
    expect(requestable(all, [], hr).ok).toBe(false);
    expect(
      requestable(
        all,
        Array.from({ length: 51 }, () => 'work_phone'),
        hr,
      ).ok,
    ).toBe(false);
  });

  it('asks again only after a day', () => {
    expect(REQUEST_AGAIN_AFTER_MS).toBe(24 * 60 * 60 * 1000);
  });
});
