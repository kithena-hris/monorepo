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
import { t } from '../lib/t';

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
                <BreadcrumbLink href="/settings?area=documents">
                  {t('components.signature-settings.settings', 'Settings')}
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>
                  {t('components.signature-settings.your_signature', 'Your signature')}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title={t('components.signature-settings.your_signature', 'Your signature')}
        description={t(
          'components.signature-settings.the_signature_your_documents_are_signed',
          'The signature your documents are signed with. It is changed here, never while signing.',
        )}
        meta={
          pending ? (
            <Badge size="sm">{t('components.signature-settings.saving', 'Saving')}</Badge>
          ) : undefined
        }
      />
      {mine === null ? (
        <Alert
          tone="info"
          title={t(
            'components.signature-settings.your_company_keeps_no_signature_on',
            'Your company keeps no signature on file',
          )}
        >
          {roles.admin
            ? t(
                'components.signature-settings.add_a_field_of_the_type',
                'Add a field of the type “A signature” in Settings › Employee fields, and choose when people are asked for it: at sign-up, during onboarding, or any time.',
              )
            : t(
                'components.signature-settings.you_adopt_one_each_time_you',
                'You adopt one each time you sign a document.',
              )}
        </Alert>
      ) : (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle level={2}>{mine.label}</CardTitle>
            <CardDescription>
              {mine.canChange
                ? t(
                    'components.signature-settings.typed_in_a_handwriting_style_or',
                    'Typed in a handwriting style, or drawn. Every box you sign takes it.',
                  )
                : t(
                    'components.signature-settings.hr_keeps_this_one_ask_them_to',
                    'HR keeps this one; ask them to change it.',
                  )}
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
              <Alert
                tone="info"
                title={t('components.signature-settings.waiting_for_hr', 'Waiting for HR')}
              >
                {t(
                  'components.signature-settings.your_new_signature_is_used_once',
                  'Your new signature is used once HR approves it; until then you sign with the one shown.',
                )}
              </Alert>
            ) : null}
            {problem === null ? null : (
              <Alert
                tone="danger"
                title={t('components.signature-settings.not_saved', 'Not saved')}
              >
                {problem}
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
