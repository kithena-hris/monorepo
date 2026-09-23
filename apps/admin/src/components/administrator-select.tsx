'use client';

import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@reach/ui';
import type { JSX } from 'react';

/**
 * Who first administers a module (PEO-112): one of the company's accounts,
 * chosen by the operator. The only way anybody first becomes a People
 * administrator — nobody is one for having been invited first.
 */
export function AdministratorSelect({
  label,
  choices,
  value,
  onChange,
  problem,
}: {
  readonly label: string;
  /** `value` is what is sent: an account id, or an email in the wizard. */
  readonly choices: readonly { readonly value: string; readonly label: string }[];
  readonly value: string | undefined;
  readonly onChange: (value: string) => void;
  readonly problem?: string | undefined;
}): JSX.Element {
  return (
    <Field required invalid={problem !== undefined}>
      <FieldLabel>{label}</FieldLabel>
      <Select value={value ?? ''} onValueChange={onChange}>
        <FieldControl>
          <SelectTrigger>
            <SelectValue placeholder="Choose somebody" />
          </SelectTrigger>
        </FieldControl>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        They become People&apos;s first administrator and HR, and grant every other role themselves.
      </FieldDescription>
      <FieldError>{problem}</FieldError>
    </Field>
  );
}
