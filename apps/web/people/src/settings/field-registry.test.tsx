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
      screen.getByText('Version 3 published 12 Sep · 4 unpublished changes'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish version 4' })).toBeEnabled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('says what is waiting to be published, and finds a field in any section', async () => {
    const user = fast();
    const { container } = render(<FieldRegistry {...props()} />);
    expect(screen.getByText('4 changes are waiting to be published')).toBeInTheDocument();
    // Each row says when it is asked and who sees it, not only its type.
    expect(screen.getByText(/One of a list · 2 options · HR only · Seen by/)).toBeInTheDocument();
    // A field whose changes wait for a second person says so in those words;
    // its classification is a badge of its own.
    expect(screen.getByText('Needs approval')).toBeInTheDocument();
    expect(screen.queryByText(/Sensitive/)).toBeNull();

    await user.click(screen.getByRole('searchbox', { name: 'Search fields' }));
    await user.paste('ethni');
    const found = screen.getByRole('table', { name: 'Matching fields' });
    expect(within(found).getByRole('rowheader', { name: 'Diversity' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Edit Employee number' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Cost centre' })).toBeInTheDocument();
    expect(screen.getByText('+ Added')).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('list', { name: 'Sections' })).getByRole('button', {
        name: /^Diversity/,
      }),
    );
    expect(screen.getByText('These rules are fixed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add field' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move Ethnicity up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Ethnicity' })).toBeInTheDocument();
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
    await user.click(within(sheet).getByRole('button', { name: 'Add field' }));
    expect(within(sheet).getByText('Give the field a name.')).toBeInTheDocument();

    // Pasted, not typed: nineteen keystrokes re-render the whole sheet nineteen
    // times and prove nothing one change does not.
    await user.click(within(sheet).getByLabelText(/^Field name/));
    await user.paste('Accommodation notes');
    // The key is an advanced option, behind its own disclosure.
    await user.click(within(sheet).getByRole('button', { name: /^Key for integrations/ }));
    expect(within(sheet).getByLabelText('Key')).toHaveValue('accommodation_notes');
    // The preview draws the field with the name as it is typed.
    expect(within(sheet).getByRole('textbox', { name: 'Accommodation notes' })).toBeInTheDocument();

    // Step 2: owners default from the section, and visibility is read back.
    expect(within(sheet).getByRole('button', { name: 'HR changes it' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(sheet).getByText(/HR can see and edit this\./)).toBeInTheDocument();

    // Step 3: when it is asked. The section is filled in by the employee, so onboarding.
    expect(within(sheet).getByRole('radio', { name: /During onboarding/ })).toBeChecked();

    // Sensitivity: the judgment is asked for from metadata, never a value.
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
    // And the review reads it all back in plain words.
    expect(
      within(sheet).getByText(
        /^The employee is asked for their Accommodation notes during onboarding\. It is optional\./,
      ),
    ).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Add field' }));
    expect(
      within(sheet).getByText('Special-category data needs your explicit confirmation.'),
    ).toBeInTheDocument();
    expect(onSaveField).not.toHaveBeenCalled();

    await user.click(within(sheet).getByRole('checkbox', { name: /I confirm/ }));
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

  it('is axe-clean with the field editor open, every part on one page', async () => {
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

    // Every stage is a radio with a name and a sentence saying what it does.
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

  it('goes back through the steps from the keyboard', async () => {
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
    // Every part is on the page, each a link away in the list beside it.
    expect(within(sheet).getByRole('group', { name: 'When is it asked?' })).toBeInTheDocument();
    const parts = within(sheet).getByRole('navigation', { name: 'Parts of the field' });
    expect(within(parts).getByRole('link', { name: /When it’s asked/ })).toHaveAttribute(
      'href',
      '#editor-when',
    );
    await user.click(within(parts).getByRole('link', { name: /The field/ }));
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
    await user.click(within(sheet).getByRole('radio', { name: /Any time, on their profile/ }));
    await within(sheet).findByText('Ordinary job data.');
    expect(within(sheet).getByText('What changes when you publish')).toBeInTheDocument();
    expect(
      within(sheet).getByText('When it is asked: Only HR fills it in → Any time, on their profile'),
    ).toBeInTheDocument();
    expect(await axeViolations(sheet)).toEqual([]);
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
    await user.click(screen.getByRole('button', { name: /Cost centre: Sign-up: required/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Optional' }));
    expect(onSignup).toHaveBeenCalledWith('cost_centre', 'optional');

    await user.click(screen.getByRole('button', { name: 'Preview sign-up' }));
    const sheet = screen.getByRole('dialog', { name: 'Sign-up preview' });
    expect(within(sheet).getByRole('navigation', { name: 'Sign-up steps' })).toHaveTextContent(
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
      screen.getByRole('button', { name: /Employee number: Assistant: not shared/ }),
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
    expect(screen.getByRole('table', { name: 'Matching fields' })).toBeInTheDocument();
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
    expect(screen.queryByRole('table', { name: 'Matching fields' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Show' })).toHaveTextContent('All fields');
  });
});
