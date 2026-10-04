'use client';

import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Textarea,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

const ExternalLinkIcon = icons.externalLink;

/**
 * "Sign in as support", with the reason it asks for first.
 *
 * A plain form posting to `companies/[id]/support` in a new tab: the operator's
 * click opens the tab, so no popup blocker stands in the way, and the tab
 * follows the redirect onto the company's app. The dialog closes once the form
 * has gone, so this tab is left as it was.
 */
export function SupportSignIn({
  companyId,
  companyName,
}: {
  readonly companyId: string;
  readonly companyName: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" startIcon={<ExternalLinkIcon aria-hidden />}>
          Sign in as support
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form
          method="post"
          action={`/companies/${companyId}/support`}
          target="_blank"
          // `noopener` and not `noreferrer`: a no-referrer form post is sent
          // with `Origin: null`, which the handler rightly refuses. The
          // referrer is dropped on the redirect to the company's app instead.
          rel="noopener"
          // After the browser has taken the submission; closing in the same
          // tick would unmount the form it is submitting.
          onSubmit={() => {
            setTimeout(() => {
              setOpen(false);
            }, 0);
          }}
        >
          <DialogHeader>
            <DialogTitle>Sign in to {companyName} as support</DialogTitle>
            <DialogDescription>
              A new tab opens on their app as Kithena support, with full administrator rights, for
              one hour. Any session that browser already has there is signed out.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field required>
              <FieldLabel>Reason</FieldLabel>
              <FieldControl>
                <Textarea name="reason" required maxLength={500} rows={3} />
              </FieldControl>
              <FieldDescription>
                A ticket number or a sentence. Recorded with your name, and shown to the company
                beside everything done in this session.
              </FieldDescription>
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="primary">
              Open as support
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
