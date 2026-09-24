'use client';

import { Checkbox, Field, FieldControl, FieldDescription, FieldLabel, Stack } from '@reach/ui';
import type { JSX, ReactNode } from 'react';

import { MODULE_CHOICES } from '../lib/modules';

/**
 * Which modules a company bought, as ticks (PEO-114).
 *
 * Checkboxes rather than switches: nothing is recorded until the form is
 * saved, and a switch promises the change happened the moment it moved.
 * `extra` renders under a ticked module, for what switching it on also asks.
 */
export function ModulesPicker({
  selected,
  onChange,
  extra,
  disabled = false,
}: {
  readonly selected: readonly string[];
  readonly onChange: (next: string[]) => void;
  readonly extra?: (key: string) => ReactNode;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <fieldset className="flex flex-col gap-4" disabled={disabled}>
      <legend className="sr-only">Modules</legend>
      {MODULE_CHOICES.map((choice) => {
        const on = selected.includes(choice.key);
        return (
          <Stack key={choice.key} gap={2}>
            <Field orientation="horizontal" className="justify-start">
              <FieldControl>
                <Checkbox
                  checked={on}
                  disabled={disabled}
                  onCheckedChange={(checked) => {
                    onChange(
                      checked === true
                        ? [...selected, choice.key]
                        : selected.filter((key) => key !== choice.key),
                    );
                  }}
                />
              </FieldControl>
              <div className="flex flex-col">
                <FieldLabel>{choice.label}</FieldLabel>
                <FieldDescription>{choice.description}</FieldDescription>
              </div>
            </Field>
            {on && extra ? <div className="pl-7">{extra(choice.key)}</div> : null}
          </Stack>
        );
      })}
    </fieldset>
  );
}
