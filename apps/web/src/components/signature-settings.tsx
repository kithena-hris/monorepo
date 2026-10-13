'use client';

import {
  Alert,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  SignatureInput,
  type SignatureValue,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import { changeMySignature } from '../app/(app)/settings/documents/signature/actions';
import type { MySignature } from '../lib/my-signature';
import { useShellData } from './app-shell';

/**
 * Settings › Documents › Your signature. Adopted here, or the first time they
 * sign; changed only here. Kept on their record by People, so a change waits
 * for HR wherever the company asked for that.
 */
export function SignatureSettings({ mine }: { readonly mine: MySignature | null }): JSX.Element {
  const { roles } = useShellData();
  const [mark, setMark] = useState<SignatureValue | null>(mine?.mark ?? null);
  const [held, setHeld] = useState(mine?.pending === true);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/settings?area=documents">Settings</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Your signature</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title="Your signature"
        description="The signature your documents are signed with. It is changed here, never while signing."
        meta={pending ? <Badge size="sm">Saving</Badge> : undefined}
      />
      {mine === null ? (
        <Alert tone="info" title="Your company keeps no signature on file">
          {roles.admin
            ? 'Add a field of the type “A signature” in Settings › Employee fields, and choose when people are asked for it: at sign-up, during onboarding, or any time.'
            : 'You adopt one each time you sign a document.'}
        </Alert>
      ) : (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle level={2}>{mine.label}</CardTitle>
            <CardDescription>
              {mine.canChange
                ? 'Typed in a handwriting style, or drawn. Every box you sign takes it.'
                : 'HR keeps this one; ask them to change it.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <SignatureInput
              name={mine.name}
              value={mark}
              disabled={!mine.canChange || pending}
              onChange={(next) => {
                if (next === null) return;
                setProblem(null);
                start(async () => {
                  const done = await changeMySignature(next);
                  if (!done.ok) {
                    setProblem(done.message);
                    return;
                  }
                  setHeld(done.held);
                  if (!done.held) setMark(next);
                });
              }}
            />
            {held ? (
              <Alert tone="info" title="Waiting for HR">
                Your new signature is used once HR approves it; until then you sign with the one
                shown.
              </Alert>
            ) : null}
            {problem === null ? null : (
              <Alert tone="danger" title="Not saved">
                {problem}
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
