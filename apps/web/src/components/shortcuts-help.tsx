'use client';

import { Button, Field, FieldControl, FieldLabel, Switch } from '@reach/ui';
import { ShortcutsDialog } from '@reach/ui/shortcuts-dialog';
import type { JSX } from 'react';

import { GROUPS, groupName } from '../lib/shortcuts';
import { Link } from '../lib/link';
import { t } from '../lib/t';
import { useShortcuts } from './shortcuts';

/**
 * `?`: every shortcut, by group, and the switch that turns single-key
 * shortcuts off (WCAG 2.1.4). A go-to shortcut to somewhere this viewer
 * cannot open is left out rather than listed as broken.
 */
export function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const { prefs, table, destinations, save } = useShortcuts();
  const groups = GROUPS.map((group) => ({
    label: groupName(group),
    shortcuts: table.filter(
      (s) => s.group === group && (s.href === undefined || destinations.has(s.id)),
    ),
  }));
  return (
    <ShortcutsDialog
      open={open}
      onOpenChange={onOpenChange}
      groups={groups}
      description={
        prefs.characterKeys
          ? t(
              'components.shortcuts.press_g_then_a_letter_to',
              'Press G, then a letter, to go somewhere. Not while you are typing in a field.',
            )
          : t(
              'components.shortcuts.single_key_shortcuts_are_off_those',
              'Single-key shortcuts are off. Those with ⌘ or Ctrl still work.',
            )
      }
      footer={
        <>
          <Field orientation="horizontal" className="gap-3">
            <FieldLabel>
              {t('components.shortcuts.single_key_shortcuts', 'Single-key shortcuts')}
            </FieldLabel>
            <FieldControl>
              <Switch
                checked={prefs.characterKeys}
                onCheckedChange={(on) => {
                  void save({ ...prefs, characterKeys: on });
                }}
              />
            </FieldControl>
          </Field>
          <Button asChild variant="ghost" size="sm">
            <Link
              href="/settings/shortcuts"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t('components.shortcuts.change_shortcuts', 'Change shortcuts')}
            </Link>
          </Button>
        </>
      }
    />
  );
}
