import { redirect } from 'next/navigation';

/** The Inbox opens on To do (INB-030); every lane is its own address. */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const params = new URLSearchParams(
    Object.entries(await searchParams).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])),
  ).toString();
  redirect(`/inbox/todo${params === '' ? '' : `?${params}`}`);
}
