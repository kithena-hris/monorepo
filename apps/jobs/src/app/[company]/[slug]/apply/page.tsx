import { Avatar } from '@reach/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { me } from '../../../../lib/account';
import { job as readJob } from '../../../../lib/api';
import { ApplyForm } from './apply-form';
import { t } from '../../../../lib/i18n';

type Params = Promise<{ company: string; slug: string }>;
type Search = Promise<{ lang?: string; src?: string }>;

export const metadata: Metadata = {
  get title(): string {
    return t('app.[company].[slug].apply.page.apply', 'Apply');
  },
  robots: { index: false },
};

/** J4: the apply flow for one job, its form as the job defines it. */
export default async function Apply({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}): Promise<JSX.Element> {
  const { company, slug } = await params;
  const { lang, src } = await searchParams;
  const answer = await readJob(company, slug, lang);
  if (!answer.ok || answer.data.closed) notFound();
  const home = await me();
  const account =
    home === null
      ? null
      : {
          name: home.name,
          email: home.email,
          defaultCv: home.cvs.find((c) => c.isDefault)?.fileName ?? null,
        };
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      {/* Whose job this is, as on its ad: the logo and the name, back to the ad. */}
      <Link
        href={`/${company}/${slug}`}
        className="flex w-fit items-center gap-3 rounded-full pe-3 hover:underline"
      >
        <Avatar
          name={answer.data.company.name}
          src={answer.data.company.logoUrl ?? undefined}
          shape="rounded"
          fit={answer.data.company.logoUrl === null ? 'cover' : 'contain'}
          size="lg"
        />
        <span className="font-semibold">{answer.data.company.name}</span>
      </Link>
      <h1 className="text-2xl font-bold">
        {t('app.[company].[slug].apply.page.apply_2', 'Apply: {{title}}', {
          title: answer.data.title,
        })}
      </h1>
      {account === null ? (
        <p className="text-sm text-fg-muted">
          <Link
            href={`/sign-in?next=/${company}/${slug}/apply`}
            className="text-accent-fg underline underline-offset-4"
          >
            {t(
              'app.[company].[slug].apply.page.sign_in_to_apply',
              'Sign in to apply without a code, with the CV you keep here.',
            )}
          </Link>
        </p>
      ) : null}
      <ApplyForm job={answer.data} source={src ?? null} account={account} />
    </div>
  );
}
