'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  CopyField,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  icons,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

const MoreIcon = icons.more;
const SendIcon = icons.send;
const DeleteIcon = icons.delete;

/**
 * What an operator can do to one row of the employee table.
 *
 * Two acts, and which ones are offered depends on the row rather than on a
 * confirmation afterwards. Somebody who has never enrolled can be sent a new
 * link or removed; somebody who has enrolled can only be sent a recovery link,
 * because removing them is termination and that is a different act with
 * different consequences than a cancelled invitation.
 *
 * The identity service enforces the same split — `mayInvite` and
 * `mayWithdrawInvitation` — so a stale row that offers the wrong thing gets a
 * refusal it can show rather than a state it can reach.
 */
export type EmployeeActionResult =
  | { ok: true; kind: 'invited'; enrolUrl: string; expiresAt: string }
  | { ok: true; kind: 'recovered' }
  | { ok: true; kind: 'withdrawn' }
  | { ok: false; message: string };

export function EmployeeActions({
  email,
  status,
  companyName,
  resend,
  withdraw,
}: {
  readonly email: string;
  readonly status: string;
  readonly companyName: string;
  /** Issues a fresh link: an invitation, or a recovery link for somebody enrolled. */
  readonly resend: () => Promise<EmployeeActionResult>;
  readonly withdraw: () => Promise<EmployeeActionResult>;
}): JSX.Element {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<EmployeeActionResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  // `provisioned` is an account commissioned but not yet invited, which the
  // wizard can leave behind. It belongs with `invited` here: nobody has used it.
  const outstanding = status === 'invited' || status === 'provisioned';

  const run = (action: () => Promise<EmployeeActionResult>): void => {
    start(async () => {
      setResult(await action());
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            startIcon={<MoreIcon aria-hidden />}
            aria-label={`Actions for ${email}`}
            disabled={pending}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onSelect={() => {
              run(resend);
            }}
          >
            <SendIcon />
            {outstanding ? 'Send a new invitation' : 'Send a recovery link'}
          </DropdownMenuItem>

          {outstanding ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onSelect={() => {
                  // Opened on the next tick, because Radix is still closing the
                  // menu on this one and the two fight over the focus trap.
                  setTimeout(() => {
                    setConfirming(true);
                  }, 0);
                }}
              >
                <DeleteIcon />
                Cancel invitation
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {/*
        An `AlertDialog`, not a `Dialog`: this destroys something and the
        component that traps focus and requires an explicit choice is the one
        for that. Cancelling is the default action.
      */}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogTitle>Cancel this invitation?</AlertDialogTitle>
          <AlertDialogDescription>
            The link sent to <strong>{email}</strong> stops working and they are removed from{' '}
            {companyName}. Nothing is kept — if they join after all, invite them again.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the invitation</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                run(withdraw);
              }}
            >
              Cancel invitation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/*
        The new link, shown once.

        It is not retrievable — the row holds only its hash — so this closes on
        the operator's say-so rather than on a timer, and there is nothing to
        show for a recovery link because that one goes to the person's own
        address and never through here.
      */}
      <Dialog
        open={result !== null}
        onOpenChange={(open) => {
          if (!open) setResult(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{titleOf(result)}</DialogTitle>
            <DialogDescription>{descriptionOf(result, email)}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {result?.ok === true && result.kind === 'invited' ? (
              <CopyField value={result.enrolUrl} label="Copy the enrolment link" mono size="sm" />
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="primary"
              onClick={() => {
                setResult(null);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function titleOf(result: EmployeeActionResult | null): string {
  if (result === null) return '';
  if (!result.ok) return 'That did not work';
  if (result.kind === 'invited') return 'A new link';
  if (result.kind === 'recovered') return 'Recovery link sent';
  return 'Invitation cancelled';
}

function descriptionOf(result: EmployeeActionResult | null, email: string): string {
  if (result === null) return '';
  if (!result.ok) return result.message;
  if (result.kind === 'invited') {
    return `Shown once and not retrievable. Any earlier link for ${email} has stopped working.`;
  }
  if (result.kind === 'recovered') {
    // Deliberately not the link. Recovery is answered to the address already on
    // the account and never through an operator, which is what keeps the weaker
    // path from becoming a way to take somebody's account.
    return `Sent to ${email}. It opens straight onto passkey setup.`;
  }
  return `${email} has been removed and their link no longer works.`;
}
