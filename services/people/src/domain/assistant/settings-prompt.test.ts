import { describe, expect, it } from 'vitest';

import { planningContext, settingsPrompt } from './settings-prompt.js';
import { ADA, MADRID_OFFICE, MADRID_SL, snapshot } from './settings.fixture.js';

/**
 * A setting written out as a request: the same words every time, everything
 * the field editor holds, and nothing about anybody.
 */

describe('copying a setting as a prompt', () => {
  it('writes a field completely: type, choices, requiredness, who fills and sees it, help, protection, place', () => {
    expect(settingsPrompt(snapshot(), { kind: 'field', key: 'shirt_size' })).toBe(
      [
        'In the employee fields, set up this field exactly as described. Keep the key as written.',
        '',
        'In the section "Personal information" (key `personal`):',
        'Field "Shirt size" (key `shirt_size`), 2 of 2 in that section:',
        '- Type: `select`.',
        '- Choices, in order: "S", "M", "L".',
        '- Required: never (optional).',
        '- Filled in by: `employee`.',
        '- Seen by: `self`, `hr`.',
        '- Asked: `onboarding`.',
        '- Help text: "For the welcome pack".',
        '- Protection: classification `internal`, personal data kind `none`.',
        '- Stored encrypted: no. The AI assistant may use it: yes.',
        '',
      ].join('\n'),
    );
  });

  it('writes a condition in words a planner can read back, naming an entity by name', () => {
    const s = snapshot();
    const withEntity = {
      ...s,
      fields: s.fields.map((f) =>
        f.key === 'contract_type'
          ? {
              ...f,
              requiredness: {
                ...f.requiredness,
                mode: 'conditional' as const,
                when: {
                  combine: 'any' as const,
                  clauses: [{ operand: 'legalEntity' as const, in: [MADRID_SL] }],
                },
              },
            }
          : f,
      ),
    } as typeof s;
    expect(settingsPrompt(withEntity, { kind: 'field', key: 'contract_type' })).toContain(
      '- Required: when any of these hold: legal entity is one of "Acme Iberia SL".',
    );
  });

  it('writes a section with every field, in order', () => {
    const text = settingsPrompt(snapshot(), { kind: 'section', key: 'personal' }) ?? '';
    expect(text).toContain(
      'Section "Personal information" (key `personal`), position 1 of 2 among the sections.',
    );
    expect(text.indexOf('`given_name`')).toBeLessThan(text.indexOf('`shirt_size`'));
    expect(text).toContain('shipped with People');
  });

  it('writes the organisation, the reminders, a pack, and a role without its holder', () => {
    const s = snapshot();
    expect(settingsPrompt(s, { kind: 'legal_entity', id: MADRID_SL })).toBe(
      'Legal entity "Acme Iberia SL": country ES, default time zone Europe/Madrid.\n',
    );
    expect(settingsPrompt(s, { kind: 'numbering', id: MADRID_SL })).toBe(
      'Employee numbering for the legal entity "Acme Iberia SL": prefix "ES-", 5 digits, starting at 100.\n',
    );
    expect(settingsPrompt(s, { kind: 'location', id: MADRID_OFFICE })).toContain(
      'in the legal entity "Acme Iberia SL"',
    );
    expect(settingsPrompt(s, { kind: 'reminders' })).toContain('no group smaller than 10 people');
    expect(settingsPrompt(s, { kind: 'country_pack', country: 'ES' })).toContain('ES country pack');
    expect(settingsPrompt(s, { kind: 'role', role: 'hr' })).toBe(
      'Give the HR role to [the person who should hold it].\n',
    );
  });

  it('never holds a person: no name, no account, whatever is copied', () => {
    const s = snapshot();
    const all = settingsPrompt(s, { kind: 'everything' }) ?? '';
    for (const p of s.people) {
      expect(all).not.toContain(p.accountId);
      expect(all).not.toContain(p.name ?? '');
    }
    expect(settingsPrompt(s, { kind: 'roles' })).not.toContain('Ada');
  });

  it('is the same text every time', () => {
    const s = snapshot();
    expect(settingsPrompt(s, { kind: 'everything' })).toBe(
      settingsPrompt(snapshot(), { kind: 'everything' }),
    );
  });

  it('is null for something that is not there', () => {
    expect(settingsPrompt(snapshot(), { kind: 'field', key: 'nothing' })).toBeNull();
    expect(settingsPrompt(snapshot(), { kind: 'country_pack', country: 'FR' })).toBeNull();
  });
});

describe('what the model is shown', () => {
  it('is the request and the settings: never a person', () => {
    const context = JSON.stringify(planningContext(snapshot(), 'Add a laptop field'));
    expect(context).toContain('Add a laptop field');
    expect(context).toContain('shirt_size');
    expect(context).not.toContain(ADA);
    expect(context).not.toContain('Lovelace');
  });
});
