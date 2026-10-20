'use client';

import { Button, icons } from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { themeCookie } from '../lib/theme';

/** Light or dark, remembered in the theme cookie; the class flips at once. */
export function ThemeToggle(): JSX.Element {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);
  const Icon = dark ? icons.theme : icons.themeDark;
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={dark ? 'Switch to light' : 'Switch to dark'}
      startIcon={<Icon aria-hidden />}
      onClick={() => {
        const next = !(dark ?? false);
        document.documentElement.classList.toggle('dark', next);
        document.cookie = themeCookie(next);
        setDark(next);
      }}
    />
  );
}
