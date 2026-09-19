'use client';

import { Alert, Button, Container, Stack } from '@reach/ui';
import Link from 'next/link';
import type { JSX } from 'react';

/**
 * What a failure looks like, instead of a 404.
 *
 * Every screen here reads through the identity service, and until this file
 * existed any failure to reach it rendered Next's "This page could not be
 * found" — because the pages called `notFound()` on anything that was not a
 * body. An operator then went looking for a deleted company while the real
 * answer was that identity was refusing the call.
 *
 * `retry`, not `reset`: re-running the failed fetch is what a temporary
 * failure needs, and `reset` only re-renders the children it already has.
 *
 * The message is only the real one in development. A server component's error
 * reaches the browser as a generic string plus `digest`, deliberately, so the
 * reference below is what ties this screen to the server log line.
 */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): JSX.Element {
  return (
    <Container size="sm" className="py-16">
      <Stack gap={5}>
        <Alert tone="danger" title="This page could not be loaded">
          {error.message === '' ? 'The identity service could not be reached.' : error.message}
        </Alert>
        {error.digest === undefined ? null : (
          <p className="text-fg-muted text-sm">
            Reference <code>{error.digest}</code> — the same id is on the server log line.
          </p>
        )}
        <Stack gap={3} className="sm:flex-row">
          <Button onClick={() => retry()}>Try again</Button>
          <Button asChild variant="secondary">
            <Link href="/">Back to companies</Link>
          </Button>
        </Stack>
      </Stack>
    </Container>
  );
}
