import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { ImportFlow, type ImportFlowProps } from './import-flow';
import { MAPPING_WITH_OFFICE, NEW_FIELDS, PLACES_HERE, PLAN_WITH_OFFICE } from './import.fixture';
import { WorkLocationsStep } from './work-locations';

/**
 * The file's work locations, set up inside the import right after Map
 * columns (the user: "Set up workplaces inline"): map each value to one here,
 * add it, or leave it empty with its people named for HR.
 */
function props(over: Partial<ImportFlowProps> = {}): ImportFlowProps {
  const ok = () => Promise.resolve({ ok: true as const });
  return {
    load: { status: 'ready', data: MAPPING_WITH_OFFICE },
    onUpload: vi.fn(ok),
    propose: vi.fn(() => Promise.resolve({ ok: true as const, data: NEW_FIELDS })),
    plan: vi.fn(() => Promise.resolve({ ok: true as const, data: PLAN_WITH_OFFICE })),
    run: vi.fn(ok),
    onDownloadBlocked: vi.fn(),
    onBack: vi.fn(),
    admin: true,
    ...over,
  };
}

const ID = '01a0e1d1-f26f-7000-be34-a7236a53ad47';

async function toPlaces(user: ReturnType<typeof fast>) {
  await user.click(screen.getByRole('button', { name: 'Next: work locations' }));
  return screen.findByRole('heading', {
    name: '3 work locations in this file. Here’s how each maps.',
  });
}

describe('the work locations in the file', () => {
  it('shows each value, how it maps, and who it is, still under Map columns', async () => {
    const user = fast();
    const { container } = render(<ImportFlow {...props()} />);
    await toPlaces(user);
    expect(screen.getByRole('navigation', { name: 'Importing people' })).toBeInTheDocument();

    // Close to one here: mapped to it, and said so.
    const branch = screen.getByRole('radiogroup', { name: 'What happens to “Scranton Branch”' });
    expect(
      within(branch).getByRole('radio', { name: /Map it to a work location here/ }),
    ).toBeChecked();
    expect(screen.getByText('Close to Scranton')).toBeInTheDocument();
    expect(
      screen.getByText('12 people in the file: Pam Beesly, Jim Halpert and 10 more'),
    ).toBeInTheDocument();

    // New: added with the file's name, its country and zone filled in.
    const stamford = screen.getByRole('radiogroup', { name: 'What happens to “Stamford”' });
    expect(
      within(stamford).getByRole('radio', { name: /Add it as a new work location/ }),
    ).toBeChecked();
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('Stamford');

    // Another system's id: left empty, its people listed by name.
    const left = screen.getByRole('table', { name: `Left without a work location: “${ID}”` });
    expect(within(left).getAllByRole('columnheader')[0]).toHaveTextContent('Name');
    expect(left).toHaveTextContent('Toby Flenderson');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('sends the choices with the plan, and the run, as they were changed', async () => {
    const user = fast();
    const plan = vi.fn(() => Promise.resolve({ ok: true as const, data: PLAN_WITH_OFFICE }));
    const run = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<ImportFlow {...props({ plan, run })} />);
    await toPlaces(user);
    // The first dry run reads the values: nothing chosen yet.
    expect(plan).toHaveBeenLastCalledWith(expect.any(Object), []);

    const stamford = screen.getByRole('radiogroup', { name: 'What happens to “Stamford”' });
    await user.clear(screen.getByRole('textbox', { name: /^Name/ }));
    expect(screen.getByRole('button', { name: 'Next: new fields' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Stamford Branch');
    const id = screen.getByRole('radiogroup', { name: `What happens to “${ID}”` });
    await user.click(within(id).getByRole('radio', { name: /Map it to a work location here/ }));
    expect(within(stamford).getByRole('radio', { name: /Add it/ })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Next: new fields' }));
    await screen.findByRole('heading', {
      name: '3 columns aren’t fields yet. Here’s what I’d create.',
    });
    await user.click(screen.getByRole('button', { name: 'Next: what about existing people?' }));
    await user.click(await screen.findByRole('button', { name: 'Next: review the plan' }));
    await screen.findByRole('heading', { name: 'Here’s everything that will happen' });
    const places = {
      'scranton branch': { kind: 'map', locationId: 'l-scr' },
      stamford: {
        kind: 'add',
        name: 'Stamford Branch',
        country: 'US',
        timeZone: 'America/New_York',
        legalEntityId: 'e-us',
      },
      [ID]: { kind: 'map', locationId: 'l-ny' },
    };
    expect(plan).toHaveBeenLastCalledWith(expect.any(Object), expect.any(Array), places);
    await user.click(screen.getByRole('button', { name: 'Approve and run' }));
    expect(run).toHaveBeenCalledWith(expect.any(Object), expect.any(Array), {
      places,
      basedOn: null,
    });
  });

  it('shows HR without an administrator the suggestions, read-only, and sends none', async () => {
    const user = fast();
    const plan = vi.fn(() => Promise.resolve({ ok: true as const, data: PLAN_WITH_OFFICE }));
    const { container } = render(<ImportFlow {...props({ admin: false, plan })} />);
    await toPlaces(user);
    expect(screen.getByText('An administrator sets up work locations')).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(await axeViolations(container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Next: new fields' }));
    await screen.findByRole('heading', {
      name: '3 columns aren’t fields yet. Here’s what I’d create.',
    });
    await user.click(screen.getByRole('button', { name: 'Next: what about existing people?' }));
    await user.click(await screen.findByRole('button', { name: 'Next: review the plan' }));
    await screen.findByRole('heading', { name: 'Here’s everything that will happen' });
    expect(plan).toHaveBeenLastCalledWith(expect.any(Object), expect.any(Array), undefined);
  });

  it('keeps its own step in the address, and Back from new fields returns to it', async () => {
    const user = fast();
    const onStepChange = vi.fn();
    const { rerender } = render(<ImportFlow {...props({ step: 'map', onStepChange })} />);
    await user.click(screen.getByRole('button', { name: 'Next: work locations' }));
    expect(onStepChange).toHaveBeenLastCalledWith('places');
    rerender(<ImportFlow {...props({ step: 'places', onStepChange })} />);
    await user.click(await screen.findByRole('button', { name: 'Next: new fields' }));
    expect(onStepChange).toHaveBeenLastCalledWith('fields');
    rerender(<ImportFlow {...props({ step: 'fields', onStepChange })} />);
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(onStepChange).toHaveBeenLastCalledWith('places');
  });

  it('shows what to check beside the prefilled country and zone, ready to change', async () => {
    const user = fast();
    const onChange = vi.fn();
    const workplaces = (PLAN_WITH_OFFICE.review.dryRun.workplaces ?? []).map((w) =>
      w.key === 'stamford'
        ? {
            ...w,
            note: 'Stamford is in United States but the file’s time zone is Asia/Kolkata: check the time zone.',
          }
        : w,
    );
    const { container } = render(
      <WorkLocationsStep
        workplaces={workplaces}
        here={PLACES_HERE}
        choices={{}}
        onChange={onChange}
        readOnly={false}
        coarse={false}
      />,
    );
    // The note and the fields it is about, on the card itself: no click to reach them.
    expect(screen.getByRole('alert')).toHaveTextContent('the file’s time zone is Asia/Kolkata');
    expect(screen.getByRole('combobox', { name: /Country/ })).toHaveTextContent('United States');
    expect(screen.getByRole('button', { name: /Time zone/ })).toHaveTextContent('America/New_York');
    // Only the noted value says so.
    expect(screen.getAllByText('Check where it is')).toHaveLength(1);
    expect(await axeViolations(container)).toEqual([]);
    await user.click(screen.getByRole('button', { name: /Time zone/ }));
    await user.type(screen.getByPlaceholderText('Search time zones'), 'London');
    await user.click(await screen.findByRole('option', { name: 'Europe/London' }));
    expect(onChange).toHaveBeenLastCalledWith(
      'stamford',
      expect.objectContaining({ kind: 'add', name: 'Stamford', timeZone: 'Europe/London' }),
    );
  });

  it('keeps the file’s zone selectable when this browser names it otherwise', async () => {
    const user = fast();
    const workplaces = (PLAN_WITH_OFFICE.review.dryRun.workplaces ?? []).map((w) =>
      w.key === 'stamford' && w.proposed.kind === 'add'
        ? { ...w, proposed: { ...w.proposed, timeZone: 'Asia/Kolkata' } }
        : w,
    );
    render(
      <WorkLocationsStep
        workplaces={workplaces}
        here={PLACES_HERE}
        choices={{}}
        onChange={vi.fn()}
        readOnly={false}
        coarse={false}
      />,
    );
    expect(screen.getByRole('button', { name: /Time zone/ })).toHaveTextContent('Asia/Kolkata');
    await user.click(screen.getByRole('button', { name: /Time zone/ }));
    await user.type(screen.getByPlaceholderText('Search time zones'), 'Kolkata');
    expect(await screen.findByRole('option', { name: 'Asia/Kolkata' })).toBeInTheDocument();
  });

  it('offers no new work location while there is no legal entity to add it to', () => {
    render(
      <WorkLocationsStep
        workplaces={PLAN_WITH_OFFICE.review.dryRun.workplaces ?? []}
        here={{ ...PLACES_HERE, entities: [] }}
        choices={{}}
        onChange={vi.fn()}
        readOnly={false}
        coarse={false}
      />,
    );
    const stamford = screen.getByRole('radiogroup', { name: 'What happens to “Stamford”' });
    expect(
      within(stamford).getByRole('radio', { name: /Add it as a new work location/ }),
    ).toBeDisabled();
    expect(
      within(stamford).getByText('There is no legal entity to add it to yet'),
    ).toBeInTheDocument();
  });
});
