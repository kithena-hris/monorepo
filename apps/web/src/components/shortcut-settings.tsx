'use client';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  KbdShortcut,
  KeyRecorder,
  PageHeader,
  Switch,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { GROUPS, SHORTCUTS, problemWith, type Shortcut } from '../lib/shortcuts';
import { useApple, useShortcuts } from './shortcuts';

const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((k, i) => b[i] === k);

/** `record` without `key`. */
function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

/**
 * Settings › Keyboard shortcuts: every shortcut in the table, grouped, the
 * go-to and on-page ones each a field that records new keys, and the switch
 * that turns single-key shortcuts off.
 *
 * Keys are checked as they are recorded (`problemWith`), and the refusal is
 * the field's error, naming what the keys already do. The server checks the
 * whole set again when it saves. They are kept with the person, not the
 * device, so they follow them.
 */
export function ShortcutSettings(): JSX.Element {
  const { prefs, table, destinations, save } = useShortcuts();
  const apple = useApple();
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const changed = Object.keys(prefs.bindings).length;

  const store = async (id: string, next: typeof prefs): Promise<void> => {
    const problem = await save(next);
    setErrors((e) => (problem === null ? without(e, id) : { ...e, [id]: problem }));
  };
  const rebind = (shortcut: Shortcut, keys: readonly string[]): void => {
    const problem = problemWith(table, shortcut.id, keys, apple);
    if (problem !== null) {
      setErrors((e) => ({ ...e, [shortcut.id]: problem }));
      return;
    }
    const bindings = without(prefs.bindings, shortcut.id);
    const initial = SHORTCUTS.find((s) => s.id === shortcut.id)?.keys ?? [];
    void store(shortcut.id, {
      ...prefs,
      bindings: same(keys, initial) ? bindings : { ...bindings, [shortcut.id]: keys },
    });
  };
  const reset = (id: string): void => {
    void store(id, { ...prefs, bindings: without(prefs.bindings, id) });
  };

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/settings">Settings</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Keyboard shortcuts</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="Keyboard shortcuts"
        description="Press a shortcut to record new keys for it: one key, or two in a row. Yours alone, and they follow you to any device you sign in on."
        actions={
          <Button
            size="sm"
            disabled={changed === 0}
            onClick={() => {
              setErrors({});
              void save({ ...prefs, bindings: {} });
            }}
          >
            Reset all to the defaults
          </Button>
        }
      />

      <Field orientation="horizontal" className="max-w-xl">
        <div className="flex flex-col gap-1">
          <FieldLabel>Single-key shortcuts</FieldLabel>
          <FieldDescription>
            Keys without ⌘ or Ctrl, like G then D or /. Turn them off if they get in the way of a
            screen reader or speech input.
          </FieldDescription>
        </div>
        <FieldControl>
          <Switch
            checked={prefs.characterKeys}
            onCheckedChange={(on) => {
              void save({ ...prefs, characterKeys: on });
            }}
          />
        </FieldControl>
      </Field>

      {GROUPS.map((group) => (
        <section key={group} aria-labelledby={`shortcuts-${group}`} className="flex flex-col gap-4">
          <h2 id={`shortcuts-${group}`} className="font-display text-lg font-bold text-fg">
            {group}
          </h2>
          <ul className="flex flex-col gap-4">
            {table
              .filter((s) => s.group === group)
              .map((s) => (
                <li key={s.id}>
                  {s.fixed === true ? (
                    <div className="grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-x-4 text-sm touch:grid-cols-1">
                      <span className="font-semibold text-fg">{s.label}</span>
                      <span className="flex items-center gap-3 text-fg-muted">
                        <KbdShortcut keys={s.keys} />
                        Always this key
                      </span>
                    </div>
                  ) : (
                    <Field orientation="columns" invalid={errors[s.id] !== undefined}>
                      <FieldLabel>{s.label}</FieldLabel>
                      <div className="flex items-center gap-2">
                        <FieldControl>
                          <KeyRecorder
                            size="sm"
                            className="max-w-60"
                            value={s.keys}
                            onValueChange={(keys) => {
                              rebind(s, keys);
                            }}
                          />
                        </FieldControl>
                        {prefs.bindings[s.id] === undefined ? null : (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Reset ${s.label}`}
                            onClick={() => {
                              reset(s.id);
                            }}
                          >
                            Reset
                          </Button>
                        )}
                      </div>
                      {s.href !== undefined && !destinations.has(s.id) ? (
                        <FieldDescription>
                          Not in your workspace: there is no {s.label} for you to open yet.
                        </FieldDescription>
                      ) : null}
                      <FieldError>{errors[s.id]}</FieldError>
                    </Field>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
