import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fast } from '../test/user';
import { axeViolations } from '../test/axe';
import { FieldEditor } from './field-editor';
import { FieldRegistry, type FieldRegistryProps } from './field-registry';
import type { ClassificationAdvice, RegistryDraft, RegistryField } from './model';

const field = (
  over: Partial<RegistryField> & Pick<RegistryField, 'key' | 'label'>,
): RegistryField => ({
  sectionKey: 'hr',
  description: null,
  dataType: 'text',
  options: [],
  requiredness: 'always',
  requiredWhen: null,
  ownership: ['hr'],
  visibility: ['self', 'manager', 'hr'],
  visibilityRules: [],
  collectAt: 'hr_only',
  classification: 'internal',
  piiKind: 'none',
  origin: 'core',
  pending: null,
  ...over,
});

const draft: RegistryDraft = {
  published: { version: 3, publishedAt: '12 Sep' },
  unpublishedChanges: 4,
  choices: {
    legalEntities: [{ value: '00000000-0000-4000-8000-0000000000e1', label: 'Acme SL' }],
    countries: [
      { value: 'ES', label: 'Spain' },
      { value: 'DE', label: 'Germany' },
    ],
    employmentTypes: [],
    workModels: [],
  },
  sections: [
    {
      key: 'hr',
      label: 'HR information',
      visibility: ['self', 'manager', 'hr'],
      ownership: ['hr'],
      origin: 'core',
      fixed: false,
    },
    {
      key: 'health',
      label: 'Health & safety',
      visibility: ['hr'],
      ownership: ['hr', 'employee'],
      origin: 'tenant',
      fixed: false,
    },
    {
      key: 'diversity',
      label: 'Diversity',
      visibility: ['hr'],
      ownership: ['employee'],
      origin: 'core',
      fixed: true,
    },
  ],
  fields: [
    field({ key: 'employee_number', label: 'Employee number', requiresApproval: true }),
    field({ key: 'hire_date', label: 'Hire date', dataType: 'date' }),
    field({
      key: 'cost_centre',
      label: 'Cost centre',
      dataType: 'select',
      options: ['ENG-204', 'ENG-201'],
      origin: 'tenant',
      pending: 'added',
    }),
    field({
      key: 'ethnicity',
      label: 'Ethnicity',
      sectionKey: 'diversity',
      classification: 'special-category',
    }),
  ],
};

/** The button whose own text this is. */
const buttonNamed = (text: string): HTMLElement => {
  const button = screen.getByText(text).closest('button');
  if (button === null) throw new Error(`no button reads ${text}`);
  return button;
};

const ok = () => Promise.resolve({ ok: true as const });

/** Saved from wherever the editor is, once the judgment is in: Save waits for it. */
async function saveWhenReady(sheet: HTMLElement): Promise<void> {
  const save = within(sheet).getByRole('button', { name: 'Save field' });
  await waitFor(() => {
    expect(save).toBeEnabled();
  });
  await fast().click(save);
}

/** A step of the editor's stepper, by its label. */
const step = (dialog: HTMLElement, label: string): HTMLElement => {
  const parts = within(dialog).getByRole('navigation', { name: 'Parts of the field' });
  const button = within(parts).getByText(label).closest('button');
  if (button === null) throw new Error(`the step ${label} cannot be opened`);
  return button;
};

function props(over: Partial<FieldRegistryProps> = {}): FieldRegistryProps {
  return {
    load: { status: 'ready', data: draft },
    today: '2026-09-23',
    advise: vi.fn(() =>
      Promise.resolve<ClassificationAdvice>({
        kind: 'protect',
        piiKind: 'health',
        reason: 'A field where HR records agreed adjustments will routinely hold a diagnosis.',
      }),
    ),
    onReorderSections: vi.fn(ok),
    onReorderFields: vi.fn(ok),
    onAddSection: vi.fn(ok),
    onSaveField: vi.fn(ok),
    preview: vi.fn(() => new Promise<never>(() => undefined)),
    onPublish: vi.fn(ok),
    ...over,
  };
}

describe('FieldRegistry', () => {
  it('shows the published version and the pending changes', async () => {
    const { container } = render(<FieldRegistry {...props()} />);
    expect(
      screen.getByText('Version 3 · published 12 Sep · 4 unpublished changes'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish version 4' })).toBeEnabled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says what is waiting to be published, and finds a field in any section', async () => {
    const user = fast();
    const { container } = render(<FieldRegistry {...props()} />);
    expect(screen.getByText('4 changes are waiting to be published')).toBeInTheDocument();
    // Each row says its type, then when it is asked and who sees it, in words.
    expect(screen.getByText('One of a list · 2 options')).toBeInTheDocument();
    expect(screen.getAllByText('HR only').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Employee, manager and HR').length).toBeGreaterThan(0);
    // A field whose changes wait for a second person says so in those words;
    // its classification is a badge of its own.
    expect(screen.getByText('Needs approval')).toBeInTheDocument();
    expect(screen.queryByText(/Sensitive/)).toBeNull();

    await user.click(screen.getByRole('searchbox', { name: 'Search fields' }));
    await user.paste('ethni');
    expect(screen.getByText('1 field matches, in 1 section')).toBeInTheDocument();
    const found = screen.getByRole('region', { name: 'Diversity' });
    expect(within(found).getByText('Ethnicity')).toBeInTheDocument();
    expect(within(found).getByText('Special category')).toBeInTheDocument();
    expect(screen.queryByText('Cost centre')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);

    await user.paste('zzz');
    expect(screen.getByText('No fields match')).toBeInTheDocument();
  });

  it('draws loading and error states from Reach', async () => {
    const user = fast();
    const { container, rerender } = render(
      <FieldRegistry {...props({ load: { status: 'loading' } })} />,
    );
    expect(screen.getByText('Loading the employee fields')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    const retry = vi.fn();
    rerender(
      <FieldRegistry {...props({ load: { status: 'error', message: 'Timed out', retry } })} />,
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says so when there are no sections', async () => {
    const empty = { ...draft, sections: [], fields: [] };
    const { container } = render(
      <FieldRegistry {...props({ load: { status: 'ready', data: empty } })} />,
    );
    expect(screen.getByText('No sections yet')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says on the name when a section of that name already exists', async () => {
    const user = fast();
    const message = 'A section called "HR information" already exists';
    const onAddSection = vi.fn(() => Promise.resolve({ ok: false as const, message }));
    render(<FieldRegistry {...props({ onAddSection })} />);
    await user.click(screen.getAllByRole('button', { name: 'Add section' })[0] as HTMLElement);
    const dialog = screen.getByRole('dialog', { name: 'Add a section' });
    const name = within(dialog).getByRole('textbox', { name: /^Name/ });
    await user.click(name);
    await user.paste(' hr information ');
    await user.click(within(dialog).getByRole('button', { name: 'Add section' }));

    expect(onAddSection).toHaveBeenCalledWith('hr information');
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
  });

  it('reorders fields from the keyboard alone', async () => {
    const user = fast();
    const onReorderFields = vi.fn(ok);
    render(<FieldRegistry {...props({ onReorderFields })} />);
    const fields = screen.getByRole('list', { name: 'Fields in HR information' });

    const down = within(fields).getByRole('button', { name: 'Move Employee number down' });
    down.focus();
    await user.keyboard('{Enter}');

    expect(onReorderFields).toHaveBeenCalledWith('hr', [
      'hire_date',
      'employee_number',
      'cost_centre',
    ]);
    // The new order shows while the save is in flight, not after.
    const labels = within(fields).getAllByRole('button', { name: /^Move .* up$/ });
    expect(labels.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Move Hire date up',
      'Move Employee number up',
      'Move Cost centre up',
    ]);
  });

  it('puts the order back and says why when the save is refused', async () => {
    const user = fast();
    const onReorderSections = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'Somebody else moved it' }),
    );
    render(<FieldRegistry {...props({ onReorderSections })} />);
    await user.click(screen.getByRole('button', { name: 'Move HR information down' }));
    expect(await screen.findByText('Somebody else moved it')).toBeInTheDocument();
    const sections = screen.getByRole('list', { name: 'Sections' });
    expect(within(sections).getAllByRole('button', { name: /^Reorder / })[0]).toHaveAccessibleName(
      'Reorder HR information',
    );
  });

  it('offers edit on every field, the built-in ones too, and no new ones in a fixed section', async () => {
    const user = fast();
    render(<FieldRegistry {...props()} />);
    // The whole row opens the editor: its name is the button.
    expect(screen.getByRole('button', { name: 'Employee number' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cost centre' })).toBeInTheDocument();
    expect(screen.getByText('+ Added')).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('list', { name: 'Sections' })).getByRole('button', {
        name: /^Diversity/,
      }),
    );
    expect(screen.getByText('These rules are fixed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add field' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move Ethnicity up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ethnicity' })).toBeInTheDocument();
  });

  it('opens the editor for the section chosen', async () => {
    const user = fast();
    render(<FieldRegistry {...props()} />);
    // By text, not by role: a role query over the whole screen computes an
    // accessible name for every element on it, which is most of what it costs.
    await user.click(buttonNamed('Health & safety'));
    await user.click(buttonNamed('Add field'));
    const sheet = await screen.findByRole('dialog', { name: 'New field' });
    expect(
      within(sheet).getByRole('navigation', { name: 'Parts of the field' }),
    ).toBeInTheDocument();
    expect(within(sheet).getAllByText(/Health & safety/).length).toBeGreaterThan(0);
  });

  it('adds a field on one page, sensitivity last, special category only with a tick', async () => {
    const user = fast();
    const onSaveField = vi.fn(ok);
    const advise = vi.fn(() =>
      Promise.resolve<ClassificationAdvice>({
        kind: 'protect',
        piiKind: 'health',
        reason: 'This looks like health data.',
      }),
    );
    // The editor on its own, as the registry opens it for Health & safety.
    // The walk through four steps is the editor's; mounting the whole registry
    // underneath it made every step re-render a tree the test is not about.
    const health = draft.sections[1];
    if (health === undefined) throw new Error('fixture has no Health & safety');
    render(
      <FieldEditor
        open
        onOpenChange={vi.fn()}
        section={health}
        field={null}
        takenKeys={draft.fields.map((f) => f.key)}
        choices={draft.choices}
        fields={draft.fields}
        advise={advise}
        onSave={onSaveField}
      />,
    );

    const sheet = await screen.findByRole('dialog', { name: 'New field' });
    // A new field moves on only once its step is complete.
    await user.click(within(sheet).getByRole('button', { name: 'Next: Access' }));
    expect(within(sheet).getByText('Give the field a name.')).toBeInTheDocument();

    // Pasted, not typed: nineteen keystrokes re-render the whole dialog nineteen
    // times and prove nothing one change does not.
    await user.click(within(sheet).getByLabelText(/^Field name/));
    await user.paste('Accommodation notes');
    // The key is an advanced option, behind its own disclosure.
    await user.click(within(sheet).getByRole('button', { name: /^Key for integrations/ }));
    expect(within(sheet).getByLabelText('Key')).toHaveValue('accommodation_notes');
    // The preview draws the field with the name as it is typed.
    expect(within(sheet).getByRole('textbox', { name: 'Accommodation notes' })).toBeInTheDocument();
    // The plain words beside it follow every step.
    expect(
      within(sheet).getByText(
        'The employee is asked for their Accommodation notes during onboarding.',
      ),
    ).toBeInTheDocument();

    // Step 2: owners default from the section.
    await user.click(within(sheet).getByRole('button', { name: 'Next: Access' }));
    expect(within(sheet).getByRole('checkbox', { name: 'HR can change' })).toBeChecked();
    expect(
      within(sheet).getByRole('checkbox', { name: 'HR can see, because they can change it' }),
    ).toBeDisabled();

    // Step 3: when it is asked. The section is filled in by the employee, so onboarding.
    await user.click(within(sheet).getByRole('button', { name: /^Next: When/ }));
    expect(within(sheet).getByRole('radio', { name: /During onboarding/ })).toBeChecked();

    // Sensitivity: the judgment is asked for from metadata, never a value.
    await user.click(within(sheet).getByRole('button', { name: 'Next: Sensitivity' }));
    expect(await within(sheet).findByText('This looks like health data.')).toBeInTheDocument();
    expect(advise).toHaveBeenLastCalledWith({
      label: 'Accommodation notes',
      description: null,
      dataType: 'text',
      sectionKey: 'health',
      options: [],
    });
    // Forced up to special category: nothing below the floor is offered.
    const kind = within(sheet).getByRole('group', { name: 'What kind of data is this?' });
    expect(within(kind).getAllByRole('radio')).toHaveLength(1);
    await user.click(within(sheet).getByRole('button', { name: 'Next: Review' }));
    expect(
      within(sheet).getByText('Special-category data needs your explicit confirmation.'),
    ).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Add field' })).toBeNull();

    await user.click(within(sheet).getByRole('checkbox', { name: /I confirm/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Next: Review' }));
    expect(
      within(sheet).getByText('Accommodation notes · Short text · Health & safety'),
    ).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Add field' }));
    await waitFor(() => {
      expect(onSaveField).toHaveBeenCalledOnce();
    });
    expect(onSaveField).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'accommodation_notes',
        sectionKey: 'health',
        classification: 'special-category',
        piiKind: 'health',
        classificationSource: 'suggested',
        visibility: ['hr'],
      }),
    );
  });

  it('ticks every See box when everyone can see a field, and keeps the groups as ticked', async () => {
    const user = fast();
    const [hr] = draft.sections;
    const costCentre = draft.fields.find((f) => f.key === 'cost_centre');
    if (hr === undefined || costCentre === undefined) throw new Error('fixture changed');
    const onSave = vi.fn(ok);
    render(
      <FieldEditor
        open
        onOpenChange={vi.fn()}
        section={hr}
        field={costCentre}
        takenKeys={[]}
        choices={draft.choices}
        fields={draft.fields}
        advise={() =>
          Promise.resolve({
            kind: 'suggest',
            classification: 'internal',
            piiKind: 'none',
            reason: 'Ordinary job data.',
            floor: 'public',
          })
        }
        onSave={onSave}
      />,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Edit Cost centre' });
    await user.click(step(sheet, 'Access'));
    const finance = within(sheet).getByRole('checkbox', { name: 'Finance can see' });
    expect(finance).not.toBeChecked();

    await user.click(within(sheet).getByRole('switch', { name: /Everyone at the company/ }));
    for (const who of ['The employee', 'Manager', 'Line managers', 'HR', 'Finance']) {
      const see = within(sheet).getByRole('checkbox', {
        name: `${who} can see, because everyone can see it`,
      });
      expect(see).toBeChecked();
      expect(see).toBeDisabled();
    }
    // Who changes it is still each group's own.
    expect(within(sheet).getByRole('checkbox', { name: 'Finance can change' })).not.toBeChecked();
    expect(await axeViolations(sheet)).toEqual([]);

    // Off again, each group is as it was ticked.
    await user.click(within(sheet).getByRole('switch', { name: /Everyone at the company/ }));
    expect(within(sheet).getByRole('checkbox', { name: 'Finance can see' })).not.toBeChecked();
    expect(within(sheet).getByRole('checkbox', { name: 'The employee can see' })).toBeChecked();

    await user.click(within(sheet).getByRole('switch', { name: /Everyone at the company/ }));
    await saveWhenReady(sheet);
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: ['self', 'manager', 'hr', 'directory'] }),
      );
    });
  });

  it('is axe-clean with the field editor open on its sensitivity step', async () => {
    const [hr] = draft.sections;
    const costCentre = draft.fields.find((f) => f.key === 'cost_centre');
    if (hr === undefined || costCentre === undefined) throw new Error('fixture changed');
    render(
      <FieldEditor
        open
        onOpenChange={vi.fn()}
        section={hr}
        field={costCentre}
        takenKeys={[]}
        choices={draft.choices}
        fields={draft.fields}
        advise={() =>
          Promise.resolve({
            kind: 'choose',
            piiKind: 'none',
            floor: 'internal',
            options: [
              { classification: 'internal', reason: 'Ordinary job data.' },
              { classification: 'confidential', reason: 'Could embarrass.' },
            ],
          })
        }
        onSave={ok}
      />,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Edit Cost centre' });
    // A saved field opens any step, ahead as well as behind.
    await fast().click(step(sheet, 'Sensitivity'));
    await within(sheet).findByText('Two answers are close');
    // `choose` offers what is at or above the floor and pre-selects nothing new.
    const kind = within(sheet).getByRole('group', { name: 'What kind of data is this?' });
    expect(within(kind).getAllByRole('radio')).toHaveLength(3);
    expect(await axeViolations(sheet)).toEqual([]);
  });

  it('starts from a template, and explains every moment a field can be asked', async () => {
    const user = fast();
    const health = draft.sections[1];
    if (health === undefined) throw new Error('fixture has no Health & safety');
    render(
      <FieldEditor
        open
        onOpenChange={vi.fn()}
        section={health}
        field={null}
        takenKeys={draft.fields.map((f) => f.key)}
        choices={draft.choices}
        fields={draft.fields}
        advise={() => new Promise<never>(() => undefined)}
        onSave={ok}
      />,
    );
    const sheet = await screen.findByRole('dialog', { name: 'New field' });
    await user.click(within(sheet).getByRole('button', { name: 'Pronouns' }));
    expect(within(sheet).getByLabelText(/^Field name/)).toHaveValue('Pronouns');
    // The key is an advanced option, behind its own disclosure.
    await user.click(within(sheet).getByRole('button', { name: /^Key for integrations/ }));
    expect(within(sheet).getByLabelText('Key')).toHaveValue('pronouns');

    // Pronouns are in the directory: everyone can see them, so every See box is ticked.
    await user.click(within(sheet).getByRole('button', { name: 'Next: Access' }));
    expect(within(sheet).getByRole('switch', { name: /Everyone at the company/ })).toBeChecked();
    expect(
      within(sheet).getByRole('checkbox', { name: 'Finance can see, because everyone can see it' }),
    ).toBeChecked();

    // Every stage is a radio with a name and a sentence saying what it does.
    await user.click(within(sheet).getByRole('button', { name: /^Next: When/ }));
    const stages = within(
      within(sheet).getByRole('group', { name: 'When is it asked?' }),
    ).getAllByRole('radio');
    expect(stages.map((r) => r.getAttribute('value'))).toEqual([
      'signup',
      'enrolment',
      'onboarding',
      'anytime',
      'hr_only',
    ]);
    for (const stage of stages) expect(stage).toHaveAccessibleDescription(/\w{20,}|\w+ \w+ \w+/);
    // The template asks at sign-up, which the screen says happens on the account setup page.
    expect(within(sheet).getByRole('radio', { name: 'At sign-up' })).toBeChecked();
    expect(within(sheet).getByText('Shown on the account setup page')).toBeInTheDocument();
    expect(await axeViolations(sheet)).toEqual([]);

    await user.click(within(sheet).getByRole('radio', { name: 'Only HR fills it in' }));
    expect(within(sheet).getByText('The employee is never shown this field')).toBeInTheDocument();
  });

  it('opens any step of a saved field, and saves from any of them', async () => {
    const user = fast();
    const [hr] = draft.sections;
    const costCentre = draft.fields.find((f) => f.key === 'cost_centre');
    if (hr === undefined || costCentre === undefined) throw new Error('fixture changed');
    render(
      <FieldEditor
        open
        onOpenChange={vi.fn()}
        section={hr}
        field={costCentre}
        takenKeys={[]}
        choices={draft.choices}
        fields={draft.fields}
        advise={() => new Promise<never>(() => undefined)}
        onSave={ok}
      />,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Edit Cost centre' });
    await user.click(step(sheet, 'When it’s asked'));
    expect(within(sheet).getByRole('group', { name: 'When is it asked?' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Save field' })).toBeInTheDocument();
    await user.click(step(sheet, 'The field'));
    expect(within(sheet).getByLabelText(/^Field name/)).toHaveValue('Cost centre');
  });

  it('says what publishing an edit would change', async () => {
    const user = fast();
    const [hr] = draft.sections;
    const costCentre = draft.fields.find((f) => f.key === 'cost_centre');
    if (hr === undefined || costCentre === undefined) throw new Error('fixture changed');
    render(
      <FieldEditor
        open
        onOpenChange={vi.fn()}
        section={hr}
        field={costCentre}
        takenKeys={[]}
        choices={draft.choices}
        fields={draft.fields}
        advise={() =>
          Promise.resolve({
            kind: 'suggest',
            classification: 'internal',
            piiKind: 'none',
            reason: 'Ordinary job data.',
            floor: 'public',
          })
        }
        onSave={ok}
      />,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Edit Cost centre' });
    await user.click(step(sheet, 'When it’s asked'));
    await user.click(within(sheet).getByRole('radio', { name: /Any time, on their profile/ }));
    await user.click(step(sheet, 'Review'));
    expect(within(sheet).getByText('What changes when you publish')).toBeInTheDocument();
    expect(
      within(sheet).getByText('When it is asked: Only HR fills it in → Any time, on their profile'),
    ).toBeInTheDocument();
    expect(await axeViolations(sheet)).toEqual([]);
  });

  it('changes a published field’s type, and goes on to review its values', async () => {
    const user = fast();
    const [hr] = draft.sections;
    if (hr === undefined) throw new Error('fixture changed');
    const start = field({ key: 'start_day', label: 'Start day', origin: 'tenant' });
    const onSave = vi.fn(ok);
    const onReview = vi.fn();
    render(
      <FieldEditor
        open
        onOpenChange={vi.fn()}
        section={hr}
        field={start}
        takenKeys={[]}
        choices={draft.choices}
        fields={draft.fields}
        sections={draft.sections}
        advise={() =>
          Promise.resolve({
            kind: 'fallback',
            classification: 'internal',
            piiKind: 'none',
            floor: 'public',
          })
        }
        onSave={onSave}
        onReview={onReview}
      />,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Edit Start day' });
    await user.click(within(sheet).getByRole('combobox', { name: /Type of answer/ }));
    await user.click(await screen.findByRole('option', { name: 'Date' }));
    expect(within(sheet).getByText(/Changed from Short text/)).toBeInTheDocument();
    expect(await axeViolations(sheet)).toEqual([]);
    await saveWhenReady(sheet);
    await waitFor(() => {
      expect(onReview).toHaveBeenCalledWith('start_day', 'date');
    });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ dataType: 'date', sectionKey: 'hr' }),
    );
  });

  it('keeps a built-in field’s type, and points at a field whose values wait for review', async () => {
    const onReview = vi.fn();
    const user = fast();
    render(
      <FieldRegistry
        {...props()}
        load={{
          status: 'ready',
          data: {
            ...draft,
            fields: [
              ...draft.fields,
              field({
                key: 'start_day',
                label: 'Start day',
                dataType: 'date',
                origin: 'tenant',
                pending: 'changed',
                review: true,
              }),
            ],
          },
        }}
        onReview={onReview}
      />,
    );
    expect(screen.getByText('Start day changes type or format')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Review the values' }));
    expect(onReview).toHaveBeenCalledWith('start_day', 'date');
  });

  it('puts a field on sign-up from its row, and previews the sign-up with its steps', async () => {
    const user = fast();
    const onSignup = vi.fn(ok);
    const onSignupDraft: RegistryDraft = {
      ...draft,
      fields: draft.fields.map((f) =>
        f.key === 'cost_centre'
          ? { ...f, signupAskable: true, signup: 'page' as const, requiredness: 'always' as const }
          : f,
      ),
    };
    const { container } = render(
      <FieldRegistry {...props({ load: { status: 'ready', data: onSignupDraft }, onSignup })} />,
    );
    await user.click(screen.getByRole('button', { name: /^Cost centre: asked at sign-up/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Optional' }));
    expect(onSignup).toHaveBeenCalledWith('cost_centre', 'optional');

    await user.click(screen.getByRole('button', { name: 'Preview sign-up' }));
    const sheet = screen.getByRole('dialog', { name: 'Sign-up preview' });
    expect(within(sheet).getByRole('navigation', { name: 'Sign-up steps' }).textContent).toMatch(
      /About you.*Your details.*Review.*Your passkey/,
    );
    await user.click(within(sheet).getByRole('button', { name: 'Next' }));
    expect(within(sheet).getByText(/Cost centre/)).toBeInTheDocument();
    expect(await axeViolations(container.ownerDocument.body)).toEqual([]);
  });

  it('shares a field with the assistant from its row, built-in ones too, never a confidential one', async () => {
    const user = fast();
    const onAssistant = vi.fn(ok);
    const shareable: RegistryDraft = {
      ...draft,
      fields: draft.fields.map((f) =>
        f.key === 'employee_number'
          ? { ...f, aiEligible: false, aiShareable: true }
          : f.key === 'ethnicity'
            ? { ...f, aiEligible: false, aiShareable: false }
            : f,
      ),
    };
    render(
      <FieldRegistry {...props({ load: { status: 'ready', data: shareable }, onAssistant })} />,
    );
    await user.click(
      screen.getByRole('button', { name: /^Employee number: assistant not shared/ }),
    );
    await user.click(screen.getByRole('menuitemradio', { name: 'Shared' }));
    expect(onAssistant).toHaveBeenCalledWith('employee_number', true);
  });
});

describe('the field list’s filters, in the address', () => {
  it('opens with the search, the filter and the section a link carried', () => {
    render(
      <FieldRegistry
        {...props({
          search: 'ethni',
          onSearchChange: vi.fn(),
          show: 'all',
          onShowChange: vi.fn(),
        })}
      />,
    );
    expect(screen.getByRole('searchbox', { name: 'Search fields' })).toHaveValue('ethni');
    expect(screen.getByRole('region', { name: 'Diversity' })).toBeInTheDocument();
  });

  it('treats a filter or a section it does not know as none', () => {
    render(
      <FieldRegistry
        {...props({
          show: 'toString',
          onShowChange: vi.fn(),
          section: 'gone',
          onSectionChange: vi.fn(),
        })}
      />,
    );
    expect(screen.queryByText(/fields? match/)).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Show' })).toHaveTextContent('All fields');
  });
});
