import { describe, expect, it } from 'vitest';

import {
  answersSchema,
  asksPayHistory,
  defaultForm,
  validateForm,
  type FormField,
} from './form.js';

describe('the apply form (PRD §8.4)', () => {
  it('starts with name, email and CV required', () => {
    const form = defaultForm();
    expect(validateForm(form).ok).toBe(true);
    expect(form.filter((f) => f.required).map((f) => f.key)).toEqual(['name', 'email', 'cv']);
  });

  it.each<[string, Partial<FormField>]>([
    ['date of birth', { key: 'custom_dob', label: 'Date of birth' }],
    ['a photo, in German', { key: 'custom_bild', label: 'Bewerbungsfoto' }],
    ['marital status, in Spanish', { key: 'custom_estado', label: 'Estado civil' }],
    ['nationality', { key: 'custom_n', label: 'Nationality' }],
    ['gender', { key: 'custom_g', label: 'Gender' }],
  ])('never asks for %s', (_what, field) => {
    const form = [
      ...defaultForm(),
      { kind: 'short_text', required: false, shown: true, ...field } as FormField,
    ];
    expect(validateForm(form)).toMatchObject({ ok: false, error: { code: 'NEVER_ASK' } });
  });

  it('always asks name and email', () => {
    const form = defaultForm().map((f) => (f.key === 'email' ? { ...f, required: false } : f));
    expect(validateForm(form)).toMatchObject({ ok: false, error: { code: 'CONTACT_REQUIRED' } });
  });

  it('knows when a form asks for pay history, and an expectation is not that', () => {
    expect(asksPayHistory(defaultForm().map((f) => ({ ...f, shown: true })))).toBe(false);
    expect(
      asksPayHistory([
        ...defaultForm(),
        {
          key: 'custom_pay',
          label: 'Current salary',
          kind: 'number',
          required: false,
          shown: true,
        },
      ]),
    ).toBe(true);
  });

  it('builds the answers schema the site, the API and storage share', () => {
    const schema = answersSchema(defaultForm());
    const good = {
      name: 'Yuki Sato',
      email: 'yuki@example.com',
      cv: { fileId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', name: 'cv.pdf' },
      right_to_work: true,
    };
    expect(schema.safeParse(good).success).toBe(true);
    expect(schema.safeParse({ ...good, email: 'not an email' }).success).toBe(false);
    // A hidden field is not accepted: the API cannot be used to ask what the form does not.
    expect(schema.safeParse({ ...good, salary_expectation: 50_000 }).success).toBe(false);
  });
});
