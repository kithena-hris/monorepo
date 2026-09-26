import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from '../input/input';
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from './field';

function renderField(invalid: boolean) {
  return render(
    <Field invalid={invalid} required>
      <FieldLabel>Legal first name</FieldLabel>
      <FieldControl>
        <Input placeholder="Ada" />
      </FieldControl>
      <FieldDescription>As it appears on the employment contract.</FieldDescription>
      <FieldError>Required.</FieldError>
    </Field>,
  );
}

describe('<Field>', () => {
  it('associates the label with the control', () => {
    renderField(false);
    expect(screen.getByLabelText(/legal first name/i)).toBeInTheDocument();
  });

  it('describes the control with its help text', () => {
    renderField(false);
    expect(screen.getByLabelText(/legal first name/i)).toHaveAccessibleDescription(
      'As it appears on the employment contract.',
    );
  });

  it('hides the error until the field is invalid', () => {
    renderField(false);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('marks the control invalid and names the error in its description', () => {
    renderField(true);
    const input = screen.getByLabelText(/legal first name/i);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Required.');
  });

  it('marks a sensitive field with a word, not only a glyph, and keeps its name', () => {
    render(
      <Field sensitive>
        <FieldLabel>Bank account</FieldLabel>
        <FieldControl>
          <Input />
        </FieldControl>
      </Field>,
    );
    const input = screen.getByLabelText(/bank account/i);
    expect(input).toHaveAccessibleName('Bank account Sensitive');
    expect(screen.getByText('Sensitive')).toBeInTheDocument();
  });

  it('announces the required state to assistive tech, not only with an asterisk', () => {
    renderField(false);
    expect(screen.getByLabelText(/legal first name/i)).toHaveAttribute('aria-required', 'true');
  });

  it('carries a caution in the description without making the field invalid', () => {
    render(
      <Field>
        <FieldLabel>Reference</FieldLabel>
        <FieldControl>
          <Input />
        </FieldControl>
        <FieldDescription tone="warning">This may be mistyped.</FieldDescription>
      </Field>,
    );
    const input = screen.getByLabelText(/reference/i);
    expect(input).toHaveAccessibleDescription('This may be mistyped.');
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('This may be mistyped.')).toHaveClass('text-warning-fg');
  });

  it('fails loudly when a part is used outside a Field', () => {
    expect(() => render(<FieldLabel>Orphan</FieldLabel>)).toThrow(/inside a <Field>/);
  });
});
