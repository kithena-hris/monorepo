import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { FieldEditor } from './field-editor';
import type { ClassificationAdvice, FieldInput, RegistryDraft, RegistryField } from './model';

/**
 * The full predicate editor for conditional requiredness (PEO-065) and custom
 * visibility rules (PEO-066), in the field editor's four steps. The grammar is
 * the contract's and the server refuses anything outside it; these prove the
 * editor can say everything the grammar can, and hands it back unchanged.
 */

const section = {
  key: 'hr',
  label: 'HR information',
  visibility: ['self', 'manager', 'hr'],
  ownership: ['hr'],
  origin: 'core',
  fixed: false,
} as const;

const field = (
  over: Partial<RegistryField> & Pick<RegistryField, 'key' | 'label'>,
): RegistryField => ({
  sectionKey: 'hr',
  description: null,
  dataType: 'text',
  options: [],
  requiredness: 'never',
  requiredWhen: null,
  ownership: ['hr'],
  visibility: ['hr'],
  visibilityRules: [],
  collectAt: 'hr_only',
  classification: 'internal',
  piiKind: 'none',
  origin: 'tenant',
  pending: null,
  ...over,
});

const costCentre = field({
  key: 'cost_centre',
  label: 'Cost centre',
  dataType: 'select',
  options: ['ENG-204', 'ENG-201'],
});
const choices: RegistryDraft['choices'] = {
  legalEntities: [{ value: '00000000-0000-4000-8000-0000000000e1', label: 'Acme SL' }],
  countries: [
    { value: 'ES', label: 'Spain' },
    { value: 'DE', label: 'Germany' },
  ],
};

const advise = (): Promise<ClassificationAdvice> =>
  Promise.resolve({
    kind: 'suggest',
    classification: 'internal',
    piiKind: 'none',
    reason: 'Ordinary job data.',
    floor: 'public',
  });

function editor(editing: RegistryField | null = null) {
  const onSave = vi.fn((_input: FieldInput) => Promise.resolve({ ok: true as const }));
  render(
    <FieldEditor
      open
      onOpenChange={vi.fn()}
      section={section}
      field={editing}
      takenKeys={[]}
      choices={choices}
      fields={[costCentre, ...(editing === null ? [] : [editing])]}
      advise={advise}
      onSave={onSave}
    />,
  );
  return onSave;
}

const saved = (onSave: ReturnType<typeof editor>): FieldInput => {
  const input = onSave.mock.calls[0]?.[0];
  if (input === undefined) throw new Error('nothing saved');
  return input;
};

async function sheetNamed(name: string) {
  return screen.findByRole('dialog', { name });
}

describe('conditional requiredness (PEO-065)', () => {
  it('is required only where the predicate holds, and the editor says what is missing', async () => {
    const user = fast();
    const onSave = editor();
    const sheet = await sheetNamed('New field');
    await user.click(within(sheet).getByLabelText(/^Label/));
    await user.paste('Work permit number');
    await user.click(within(sheet).getByRole('button', { name: 'Next' }));

    await user.click(within(sheet).getByRole('radio', { name: /Required when/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Next' }));
    expect(
      within(sheet).getByText('Every condition needs at least one value.'),
    ).toBeInTheDocument();

    await user.click(
      within(sheet).getByRole('button', { name: 'Required when, condition 1: is one of' }),
    );
    await user.click(screen.getByRole('option', { name: 'Spain' }));
    await user.keyboard('{Escape}');
    await user.click(within(sheet).getByRole('button', { name: 'Next' }));
    await user.click(within(sheet).getByRole('button', { name: 'Next' }));
    await within(sheet).findByText('Ordinary job data.');
    await user.click(within(sheet).getByRole('button', { name: 'Add field' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledOnce();
    });
    expect(saved(onSave)).toMatchObject({
      requiredness: 'conditional',
      requiredWhen: { combine: 'all', clauses: [{ operand: 'country', in: ['ES'] }] },
      visibilityRules: [],
    });
  });

  it('can read another field, compared against the option key rather than its label', async () => {
    const user = fast();
    const onSave = editor();
    const sheet = await sheetNamed('New field');
    await user.click(within(sheet).getByLabelText(/^Label/));
    await user.paste('Lab badge');
    await user.click(within(sheet).getByRole('button', { name: 'Next' }));
    await user.click(within(sheet).getByRole('radio', { name: /Required when/ }));

    const n = 'Required when, condition 1';
    await user.click(within(sheet).getByRole('combobox', { name: `${n}: what it reads` }));
    await user.click(screen.getByRole('option', { name: 'Another field' }));
    await user.click(within(sheet).getByRole('combobox', { name: `${n}: which field` }));
    await user.click(screen.getByRole('option', { name: 'Cost centre' }));
    await user.click(within(sheet).getByRole('combobox', { name: `${n}: how it is compared` }));
    await user.click(screen.getByRole('option', { name: 'equals' }));
    await user.click(within(sheet).getByRole('combobox', { name: `${n}: the value` }));
    await user.click(screen.getByRole('option', { name: 'ENG-204' }));

    await user.click(within(sheet).getByRole('button', { name: 'Add a condition' }));
    await user.click(
      within(sheet).getByRole('combobox', { name: 'Required when: how the conditions combine' }),
    );
    await user.click(screen.getByRole('option', { name: 'Any of these holds' }));
    await user.click(
      within(sheet).getByRole('button', { name: 'Required when, condition 2: is one of' }),
    );
    await user.click(screen.getByRole('option', { name: 'Germany' }));
    await user.keyboard('{Escape}');

    await user.click(within(sheet).getByRole('button', { name: 'Next' }));
    await user.click(within(sheet).getByRole('button', { name: 'Next' }));
    await within(sheet).findByText('Ordinary job data.');
    await user.click(within(sheet).getByRole('button', { name: 'Add field' }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledOnce();
    });
    expect(saved(onSave).requiredWhen).toEqual({
      combine: 'any',
      clauses: [
        { operand: 'attribute', key: 'cost_centre', is: 'equals', equals: 'eng_204' },
        { operand: 'country', in: ['DE'] },
      ],
    });
  });

  it('keeps an existing predicate through an edit rather than collapsing it to optional', async () => {
    const user = fast();
    const when = {
      combine: 'all' as const,
      clauses: [{ operand: 'status' as const, in: ['active'] }],
    };
    const onSave = editor(
      field({ key: 'permit', label: 'Permit', requiredness: 'conditional', requiredWhen: when }),
    );
    const sheet = await sheetNamed('Edit Permit');
    for (let step = 0; step < 3; step += 1) {
      // eslint-disable-next-line no-await-in-loop -- one step after another, as a person clicks
      await user.click(within(sheet).getByRole('button', { name: 'Next' }));
    }
    await within(sheet).findByText('Ordinary job data.');
    await user.click(within(sheet).getByRole('button', { name: 'Save field' }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledOnce();
    });
    expect(saved(onSave)).toMatchObject({ requiredness: 'conditional', requiredWhen: when });
  });

  it('may not read special-category data, and says why beside the condition', async () => {
    const user = fast();
    const disability = field({
      key: 'disability',
      label: 'Disability',
      classification: 'special-category',
    });
    const onSave = vi.fn((_input: FieldInput) => Promise.resolve({ ok: true as const }));
    render(
      <FieldEditor
        open
        onOpenChange={vi.fn()}
        section={section}
        field={null}
        takenKeys={[]}
        choices={choices}
        fields={[costCentre, disability]}
        advise={advise}
        onSave={onSave}
      />,
    );
    const sheet = await sheetNamed('New field');
    await user.click(within(sheet).getByLabelText(/^Label/));
    await user.paste('Workplace adjustment');
    await user.click(within(sheet).getByRole('button', { name: 'Next' }));
    await user.click(within(sheet).getByRole('radio', { name: /Required when/ }));

    const n = 'Required when, condition 1';
    await user.click(within(sheet).getByRole('combobox', { name: `${n}: what it reads` }));
    await user.click(screen.getByRole('option', { name: 'Another field' }));
    await user.click(within(sheet).getByRole('combobox', { name: `${n}: which field` }));
    await user.click(screen.getByRole('option', { name: 'Disability' }));
    await user.click(within(sheet).getByRole('button', { name: 'Next' }));

    expect(within(sheet).getByText(/Disability is special-category data/)).toBeInTheDocument();
    expect(within(sheet).getByRole('radio', { name: /Required when/ })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('custom visibility rules (PEO-066)', () => {
  it('shows a field to managers, of contractors only', async () => {
    const user = fast();
    const onSave = editor(costCentre);
    const sheet = await sheetNamed('Edit Cost centre');
    await user.click(within(sheet).getByRole('button', { name: 'Next' }));
    await user.click(within(sheet).getByRole('button', { name: 'Next' }));

    await user.click(within(sheet).getByRole('button', { name: 'Add a rule' }));
    const n = 'Rule 1: when, condition 1';
    await user.click(within(sheet).getByRole('combobox', { name: `${n}: what it reads` }));
    await user.click(screen.getByRole('option', { name: 'Employment type' }));
    await user.click(within(sheet).getByRole('button', { name: `${n}: is one of` }));
    await user.click(screen.getByRole('option', { name: 'Contractor' }));
    await user.keyboard('{Escape}');
    expect(await axeViolations(sheet)).toEqual([]);

    await user.click(within(sheet).getByRole('button', { name: 'Next' }));
    await within(sheet).findByText('Ordinary job data.');
    await user.click(within(sheet).getByRole('button', { name: 'Save field' }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledOnce();
    });
    expect(saved(onSave).visibilityRules).toEqual([
      {
        scopes: ['manager'],
        when: { combine: 'all', clauses: [{ operand: 'employmentType', in: ['contractor'] }] },
      },
    ]);
  });

  it('is refused for special-category data before it reaches the server', async () => {
    const user = fast();
    const onSave = editor(
      field({
        key: 'health_note',
        label: 'Health note',
        classification: 'special-category',
        visibilityRules: [
          {
            scopes: ['manager'],
            when: { combine: 'all', clauses: [{ operand: 'country', in: ['ES'] }] },
          },
        ],
      }),
    );
    const sheet = await sheetNamed('Edit Health note');
    for (let step = 0; step < 3; step += 1) {
      // eslint-disable-next-line no-await-in-loop -- one step after another, as a person clicks
      await user.click(within(sheet).getByRole('button', { name: 'Next' }));
    }
    await within(sheet).findByText('Ordinary job data.');
    await user.click(within(sheet).getByRole('button', { name: 'Save field' }));
    expect(within(sheet).getByText(/never shown by a rule/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal of a rule that would disclose what it reads', async () => {
    // Whether a scope may read a placement fact is the server's to judge
    // (VISIBILITY_RULE_DISCLOSES); the editor keeps the sheet open and says so.
    const user = fast();
    const message =
      'Cost centre is shown by a rule on employment status, which not everybody it is shown to may read';
    const onSave = vi.fn((_input: FieldInput) =>
      Promise.resolve({ ok: false as const, message }),
    );
    render(
      <FieldEditor
        open
        onOpenChange={vi.fn()}
        section={section}
        field={costCentre}
        takenKeys={[]}
        choices={choices}
        fields={[costCentre]}
        advise={advise}
        onSave={onSave}
      />,
    );
    const sheet = await sheetNamed('Edit Cost centre');
    for (let step = 0; step < 3; step += 1) {
      // eslint-disable-next-line no-await-in-loop -- one step after another, as a person clicks
      await user.click(within(sheet).getByRole('button', { name: 'Next' }));
    }
    await within(sheet).findByText('Ordinary job data.');
    await user.click(within(sheet).getByRole('button', { name: 'Save field' }));
    const alert = await within(sheet).findByText(message);
    expect(alert.closest('[role="alert"]') ?? alert).toBeInTheDocument();
    expect(within(sheet).getByText('Not saved')).toBeInTheDocument();
  });
});
