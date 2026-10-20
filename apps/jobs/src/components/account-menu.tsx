'use client';

import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  icons,
} from '@reach/ui';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';

/**
 * The signed-in candidate, at the top of every page: their picture and first
 * name open a menu with their applications, their CVs and sign-out. The
 * menu moves as every surface does, from the side it opens from.
 */
export function AccountMenu({
  name,
  email,
  pictureUrl,
}: {
  readonly name: string;
  readonly email: string;
  readonly pictureUrl: string | null;
}): JSX.Element {
  const router = useRouter();
  const first = name.split(' ')[0] ?? name;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={name}
        className="relative flex min-h-tap items-center gap-2 rounded-full py-1 pe-3 ps-1 text-sm font-medium hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
      >
        <Avatar name={name} src={pictureUrl ?? undefined} size="sm" aria-hidden />
        <span className="hidden sm:inline">{first}</span>
        <icons.expand aria-hidden className="size-4 text-fg-subtle" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2.5 py-2 text-sm font-normal text-fg">
          <Avatar name={name} src={pictureUrl ?? undefined} size="sm" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{name}</span>
            <span className="block truncate text-xs text-fg-muted">{email}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            router.push('/me');
          }}
        >
          <icons.work />
          Your applications
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            router.push('/me#cvs');
          }}
        >
          <icons.document />
          Your CVs
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            router.push('/me/cv');
          }}
        >
          <icons.assistant />
          Write a CV with AI
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            const form = document.createElement('form');
            form.method = 'post';
            form.action = '/auth/sign-out';
            document.body.append(form);
            form.submit();
          }}
        >
          <icons.signOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
