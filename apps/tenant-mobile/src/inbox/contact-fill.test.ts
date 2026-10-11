import { describe, expect, it } from 'vitest';

import { contactShaped, valuesFrom } from './contact-fill';

const fields = [
  { key: 'emergency_contact_name', label: 'Full name', dataType: 'text' },
  { key: 'emergency_contact_relationship', label: 'Relationship', dataType: 'select' },
  { key: 'emergency_contact_phone', label: 'Phone', dataType: 'phone' },
];

describe('a contact poured into a task’s fields', () => {
  it('knows a task a contact can fill, and fills its name and number', () => {
    expect(contactShaped(fields)).toBe(true);
    expect(contactShaped([{ key: 'iban', label: 'IBAN', dataType: 'bank_account' }])).toBe(false);
    expect(
      valuesFrom(fields, { name: 'Clara Novak', phone: '+420 604 112 980', email: null }),
    ).toEqual({
      emergency_contact_name: 'Clara Novak',
      emergency_contact_phone: '+420604112980',
    });
  });
});
