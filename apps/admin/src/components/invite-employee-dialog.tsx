'use client';

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { InviteEmployeeForm, type InviteResult } from './invite-employee-form';

const AddIcon = icons.add;

/**
 * Inviting somebody, behind a button.
 *
 * It was a permanent panel on the company page, which put a form for an
 * occasional act between an operator and the list of people they came to read.
 * Inviting happens on a company's first day and then rarely; the page is opened
 * to check something far more often than to add somebody.
 *
 * The dialog does not close itself on success, deliberately. The enrolment link
 * is shown once and is not retrievable — the row holds only its hash — so
 * closing the sheet the moment the invitation succeeds would throw away the one
 * copy of the thing the operator came for.
 */
export function InviteEmployeeDialog({
  action,
  companyName,
}: {
  readonly action: (previous: InviteResult | null, form: FormData) => Promise<InviteResult>;
  readonly companyName: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm" startIcon={<AddIcon aria-hidden />}>
          Invite an employee
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite an employee to {companyName}</DialogTitle>
          <DialogDescription>
            They are sent a link and set up a passkey on their own device. You are not given a way
            to sign in as them.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <InviteEmployeeForm action={action} companyName={companyName} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
