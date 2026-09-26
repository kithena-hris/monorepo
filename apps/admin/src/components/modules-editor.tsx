'use client';

import {
  Badge,
  Combobox,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Stack,
  Switch,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { MODULE_CHOICES } from '../lib/modules';

/** Which modules are on, and who administers each (PEO-114, PEO-112). */
export interface ModulesDraft {
  readonly on: readonly string[];
  readonly administrators: Readonly<Record<string, readonly string[]>>;
}

/** Somebody who can be named: `value` is what is sent, an account id or an email. */
export interface Nameable {
  readonly value: string;
  readonly label: string;
}

const ADMINISTERED = MODULE_CHOICES.filter((c) => c.administered).map((c) => c.key as string);

function listOf(draft: ModulesDraft, key: string): readonly string[] {
  return draft.administrators[key] ?? [];
}

/** The administered modules switched on. */
function administeredOn(draft: ModulesDraft): string[] {
  return ADMINISTERED.filter((key) => draft.on.includes(key));
}

/** Whether every administered module switched on has the same administrators. */
export function sameEverywhere(draft: ModulesDraft): boolean {
  const lists = administeredOn(draft).map((key) => [...listOf(draft, key)].toSorted().join());
  return new Set(lists).size <= 1;
}

/**
 * The modules a company has and who runs each, as one list: a switch per
 * module and, under each administered module switched on, the people who
 * administer it.
 *
 * "Same administrators for every module" collapses the per-module pickers into
 * one at the top, whose choice every administered module switched on takes —
 * including one switched on afterwards. Turning it off leaves each module with
 * that choice to edit on its own. It starts on when the modules already agree.
 *
 * Controlled, and it records nothing: the company page saves the draft in one
 * request, and the wizard sends it with the company.
 */
export function ModulesEditor({
  value,
  onChange,
  people,
  problems = {},
  disabled = false,
  emptyMessage = 'Nobody matches.',
}: {
  readonly value: ModulesDraft;
  readonly onChange: (next: ModulesDraft) => void;
  readonly people: readonly Nameable[];
  /** Module → what is wrong with its administrators. */
  readonly problems?: Readonly<Record<string, string | undefined>>;
  readonly disabled?: boolean;
  /** What the picker says when there is nobody to choose. */
  readonly emptyMessage?: string;
}): JSX.Element {
  const [shared, setShared] = useState(() => sameEverywhere(value));
  const [sharedList, setSharedList] = useState<readonly string[]>(() =>
    listOf(value, administeredOn(value)[0] ?? ''),
  );
  const options = people.map((p) => ({ value: p.value, label: p.label }));
  const asList = (next: string | readonly string[] | null): readonly string[] =>
    next === null ? [] : typeof next === 'string' ? [next] : next;

  const withEveryone = (draft: ModulesDraft, list: readonly string[]): ModulesDraft => ({
    ...draft,
    administrators: {
      ...draft.administrators,
      ...Object.fromEntries(administeredOn(draft).map((key) => [key, list])),
    },
  });

  const toggle = (key: string, on: boolean): void => {
    const next: ModulesDraft = {
      ...value,
      on: on ? [...value.on.filter((k) => k !== key), key] : value.on.filter((k) => k !== key),
    };
    onChange(on && shared ? withEveryone(next, sharedList) : next);
  };

  const shareAll = (on: boolean): void => {
    setShared(on);
    if (!on) return;
    // Everybody administering any of them, so nobody loses a module by the
    // switch; the change is shown before anything is saved.
    const everyone = [...new Set(administeredOn(value).flatMap((key) => listOf(value, key)))];
    setSharedList(everyone);
    onChange(withEveryone(value, everyone));
  };

  const anyAdministeredOn = administeredOn(value).length > 0;
  const sharedProblem = administeredOn(value)
    .map((key) => problems[key])
    .find(Boolean);

  return (
    <Stack gap={5}>
      {ADMINISTERED.length > 1 ? (
        <Field orientation="horizontal" disabled={disabled}>
          <div className="flex flex-col">
            <FieldLabel>Same administrators for every module</FieldLabel>
            <FieldDescription>
              {shared
                ? 'One choice runs every module switched on. Turn off to choose per module.'
                : 'Each module has its own administrators.'}
            </FieldDescription>
          </div>
          <FieldControl>
            <Switch checked={shared} disabled={disabled} onCheckedChange={shareAll} />
          </FieldControl>
        </Field>
      ) : null}

      {shared && anyAdministeredOn ? (
        <Field required invalid={sharedProblem !== undefined} disabled={disabled}>
          <FieldLabel>Administrators</FieldLabel>
          <FieldControl>
            <Combobox
              multiple
              chips
              label="Administrators"
              options={options}
              value={sharedList}
              disabled={disabled}
              placeholder="Add administrators"
              searchPlaceholder="Search by email"
              emptyMessage={emptyMessage}
              onChange={(next) => {
                const list = asList(next);
                setSharedList(list);
                onChange(withEveryone(value, list));
              }}
            />
          </FieldControl>
          <FieldDescription>
            They administer every module switched on below, and grant every other role themselves.
          </FieldDescription>
          <FieldError>{sharedProblem}</FieldError>
        </Field>
      ) : null}

      <ul className="divide-border flex flex-col divide-y" aria-label="Modules">
        {MODULE_CHOICES.map((choice) => {
          const isOn = value.on.includes(choice.key);
          const problem = problems[choice.key];
          return (
            <li key={choice.key} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
              <Field orientation="horizontal" disabled={disabled}>
                <div className="flex min-w-0 flex-col">
                  <FieldLabel>{choice.label}</FieldLabel>
                  <FieldDescription>{choice.description}</FieldDescription>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge tone={isOn ? 'success' : 'neutral'} dot={isOn}>
                    {isOn ? 'On' : 'Off'}
                  </Badge>
                  <FieldControl>
                    <Switch
                      aria-label={`${choice.label} module`}
                      checked={isOn}
                      disabled={disabled}
                      onCheckedChange={(on) => {
                        toggle(choice.key, on);
                      }}
                    />
                  </FieldControl>
                </div>
              </Field>
              {isOn && choice.administered && !shared ? (
                <Field required invalid={problem !== undefined} disabled={disabled}>
                  <FieldLabel>{choice.label} administrators</FieldLabel>
                  <FieldControl>
                    <Combobox
                      multiple
                      chips
                      label={`${choice.label} administrators`}
                      options={options}
                      value={listOf(value, choice.key)}
                      disabled={disabled}
                      placeholder="Add administrators"
                      searchPlaceholder="Search by email"
                      emptyMessage={emptyMessage}
                      onChange={(next) => {
                        onChange({
                          ...value,
                          administrators: { ...value.administrators, [choice.key]: asList(next) },
                        });
                      }}
                    />
                  </FieldControl>
                  <FieldError>{problem}</FieldError>
                </Field>
              ) : null}
              {isOn && choice.administered && shared ? (
                <p className="text-fg-muted text-sm">Run by the administrators above.</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Stack>
  );
}
