import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { axeViolations } from '../test/axe';
import { fast } from '../test/user';
import { SectionForm } from '../record/section-form';
import type { RecordSection } from '../record/model';
import { IdentifierReviews, type ReviewItem } from './identifier-reviews';

const item: ReviewItem = {
  personId: 'p1',
  name: 'Lucía Ortega',
  attributeKey: 'es_nif',
  label: 'NIF / NIE',
  last4: '678A',
  findings: [
    {
      level: 'mismatch',
      code: 'check_mismatch',
      message: 'Matches the national format, but the control letter does not compute.',
    },
  ],
  enteredAt: '2026-09-24T09:00:00.000Z',
};

const done = () => Promise.resolve({ ok: true as const });

describe('HR’s review of doubted identifiers (PEO-125)', () => {
  it('lists each with its findings and last four, never the value until asked', async () => {
    const onReveal = vi.fn(() => Promise.resolve({ ok: true as const, value: '12345678A' }));
    const { container } = render(
      <IdentifierReviews
        load={{ status: 'ready', data: { items: [item] } }}
        onDecide={vi.fn(done)}
        onReveal={onReveal}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
    expect(screen.getByText('•••• 678A')).toBeInTheDocument();
    expect(screen.getByText(/control letter does not compute/)).toBeInTheDocument();
    expect(screen.queryByText('12345678A')).not.toBeInTheDocument();

    await fast().click(screen.getByRole('button', { name: /Show Lucía Ortega's NIF/ }));
    expect(onReveal).toHaveBeenCalledWith('p1', 'es_nif');
    expect(await screen.findByText('12345678A')).toBeInTheDocument();
  });

  it('accepts, finally, and sends back only with a reason', async () => {
    const onDecide = vi.fn(done);
    render(
      <IdentifierReviews
        load={{ status: 'ready', data: { items: [item] } }}
        onDecide={onDecide}
        onReveal={vi.fn()}
      />,
    );
    const user = fast();
    await user.click(screen.getByRole('button', { name: /Accept Lucía Ortega's/ }));
    expect(screen.getByText(/will not be flagged again/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(onDecide).toHaveBeenCalledWith('p1', 'es_nif', 'accept', null);

    await user.click(screen.getByRole('button', { name: /Send Lucía Ortega's NIF \/ NIE back/ }));
    // Sent back without saying why, the employee cannot tell what to fix.
    await user.click(screen.getByRole('button', { name: 'Send back' }));
    expect(onDecide).toHaveBeenCalledTimes(1);
    const reason = screen.getByRole('textbox', { name: /What is wrong/ });
    expect(reason).toHaveAccessibleDescription(/Say what is wrong/);
    await user.type(reason, 'Check your card');
    await user.click(screen.getByRole('button', { name: 'Send back' }));
    expect(onDecide).toHaveBeenLastCalledWith('p1', 'es_nif', 'send_back', 'Check your card');
  });

  it('marks a value still waiting for approval, and says sending it back declines the change', async () => {
    const { container } = render(
      <IdentifierReviews
        load={{ status: 'ready', data: { items: [{ ...item, held: true }] } }}
        onDecide={vi.fn(done)}
        onReveal={vi.fn()}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
    await fast().click(screen.getByRole('button', { name: /Send Lucía Ortega's NIF \/ NIE back/ }));
    expect(screen.getByText(/The change is declined, and Lucía Ortega is asked to correct it/))
      .toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('says when there is nothing to review', () => {
    render(
      <IdentifierReviews
        load={{ status: 'ready', data: { items: [] } }}
        onDecide={vi.fn(done)}
        onReveal={vi.fn()}
      />,
    );
    expect(screen.getByText('Nothing to review')).toBeInTheDocument();
  });
});

describe('a form carrying a doubtful identifier (PEO-125)', () => {
  const section: RecordSection = {
    key: 'identification',
    label: 'Identification',
    visibility: ['self', 'hr'],
    fields: [
      {
        key: 'es_nif',
        label: 'NIF / NIE',
        description: null,
        dataType: 'national_id',
        options: [],
        required: false,
        readOnly: false,
      },
    ],
  };
  const finding = {
    key: 'es_nif',
    label: 'NIF / NIE',
    level: 'mismatch' as const,
    code: 'check_mismatch',
    message: 'Matches the national format, but the control letter does not compute.',
    review: 'none' as const,
  };

  it('warns before saving, on the field and above the button, and still lets it be saved', async () => {
    const onCheck = vi.fn(() => Promise.resolve({ ok: true as const, findings: [finding] }));
    const onSave = vi.fn(() =>
      Promise.resolve({ ok: true as const, findings: [{ ...finding, review: 'pending' as const }] }),
    );
    const { container } = render(
      <SectionForm section={section} values={{}} onSave={onSave} onCheck={onCheck} />,
    );
    const user = fast();
    await user.type(screen.getByRole('textbox', { name: 'NIF / NIE' }), '12345678A');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onCheck).toHaveBeenCalledWith('identification', { es_nif: '12345678A' });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Our checks suggest this may be wrong')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'NIF / NIE' })).toHaveAccessibleDescription(
      /control letter does not compute/,
    );
    expect(await axeViolations(container)).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Save anyway' }));
    expect(onSave).toHaveBeenCalledWith('identification', { es_nif: '12345678A' });
    expect(await screen.findByText('Saved, and sent to HR for review')).toBeInTheDocument();
  });

  it('asks again when the value changes after a warning', async () => {
    const onCheck = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, findings: [finding] })
      .mockResolvedValueOnce({ ok: true, findings: [] });
    const onSave = vi.fn(() => Promise.resolve({ ok: true as const, findings: [] }));
    render(<SectionForm section={section} values={{}} onSave={onSave} onCheck={onCheck} />);
    const user = fast();
    const input = screen.getByRole('textbox', { name: 'NIF / NIE' });
    await user.type(input, '12345678A');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.clear(input);
    await user.type(input, '12345678Z');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onCheck).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenCalledWith('identification', { es_nif: '12345678Z' });
  });
});
