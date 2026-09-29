import 'server-only';

import { people } from './people';

/**
 * What the entry dashboard shows from People, read as the person signed in:
 * what waits for them, how complete the records are, and who is starting.
 *
 * Every figure is People's answer or it is absent. A viewer People gives no
 * directory totals (or a company without People) gets fewer tiles, never a
 * made-up number.
 */
export interface HomeData {
  readonly now: string;
  readonly approvals: {
    readonly isHr: boolean;
    readonly total: number;
    readonly items: readonly {
      readonly id: string;
      readonly name: string;
      readonly avatarUrl: string | null;
      readonly label: string;
      readonly requestedAt: string;
      readonly requestedBy: string;
    }[];
  } | null;
  readonly me: { readonly missing: number | null; readonly required: number } | null;
  /** The directory's own counts, where this viewer may see them. */
  readonly directory: {
    readonly total: number;
    readonly incomplete: number | null;
    readonly notStarted: number | null;
  } | null;
  readonly starting: readonly {
    readonly id: string;
    readonly name: string;
    readonly avatarUrl: string | null;
    readonly detail: string;
  }[];
}

interface Directory {
  readonly total: number;
  readonly incomplete: number | null;
  readonly notStarted: number | null;
  readonly columns: readonly { readonly key: string; readonly label: string }[];
  readonly people: readonly {
    readonly id: string;
    readonly name: string;
    readonly avatarUrl: string | null;
    readonly values: readonly { readonly key: string; readonly value: string }[];
  }[];
}

/** Starting soon: pre-hire people, soonest first, at most five. */
const STARTING = {
  conditions: [{ key: 'status', op: 'is', values: ['pre_hire'] }],
  sort: 'hire_date:asc',
};

export async function homeData(entitlements: readonly string[]): Promise<HomeData | null> {
  if (!entitlements.includes('module.people')) return null;
  // The directory twice: once whole for its counts (a count is narrowed by the
  // conditions it is asked with), once for who is starting.
  const [overview, everyone, directory] = await Promise.all([
    people<Omit<HomeData, 'directory' | 'starting'>>('Overview'),
    people<Directory>('Directory'),
    people<Directory>('Directory', STARTING),
  ]);
  if (!overview.ok) return null;
  const all = everyone.ok ? everyone.data : null;
  const dir = directory.ok ? directory.data : null;
  const value = (p: Directory['people'][number], key: string): string | undefined =>
    p.values.find((v) => v.key === key)?.value;
  return {
    now: overview.data.now,
    approvals: overview.data.approvals,
    me: overview.data.me,
    directory:
      all === null
        ? null
        : { total: all.total, incomplete: all.incomplete, notStarted: all.notStarted },
    starting: (dir?.people ?? []).slice(0, 5).map((p) => ({
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl,
      detail: [value(p, 'job_title'), value(p, 'hire_date')]
        .filter((x) => x !== undefined && x !== '')
        .join(' · '),
    })),
  };
}
