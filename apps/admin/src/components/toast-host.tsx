'use client';

import { ToastProvider } from '@reach/ui';
import type { JSX, ReactNode } from 'react';

/**
 * The toast host, mounted once at the root.
 *
 * A client boundary rather than putting `ToastProvider` in the layout directly:
 * the layout is a server component, and the provider owns React state. This is
 * the thinnest wrapper that can hold it, so everything below stays a server
 * component unless it asks not to be.
 *
 * `ToastProvider` renders its own viewport, so there is nothing else to mount.
 */
export function ToastHost({ children }: { children: ReactNode }): JSX.Element {
  return <ToastProvider>{children}</ToastProvider>;
}
