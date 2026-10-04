'use client';

import {
  Badge,
  Chip,
  EmptyState,
  PageHeader,
  SearchField,
  SettingsCard,
  Skeleton,
  TertiaryNav,
  icons,
  type IconName,
} from '@reach/ui';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type JSX } from 'react';

import { noteInAddress } from '../lib/url-state';
import { Waking } from './waking';

/**
 * Settings (S1): every module's settings as cards that say how each is set
 * today, so an administrator sees what is set without opening anything.
 *
 * A search narrows the cards by name and description; the chips over them are
 * the states that want attention (a draft to publish, a role nobody holds),
 * each a way to the setting that fixes it. The list on the left is the
 * modules this company has, and the page shows the one chosen.
 */
export interface SettingsModule {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly settings: readonly {
    readonly path: string;
    readonly label: string;
    readonly description?: string | undefined;
    readonly icon?: string | undefined;
    /** How it is set now, in a few words; empty while still to come. */
    readonly now: string | null;
    /** A state that wants attention: the card's badge, and the chip over the cards. */
    readonly attention: { readonly badge: string; readonly chip: string } | null;
  }[];
}

function Icon({ name }: { readonly name: string | undefined }): JSX.Element {
  const Glyph = name !== undefined && name in icons ? icons[name as IconName] : icons.settings;
  return <Glyph aria-hidden />;
}

export function SettingsIndex({
  modules,
  waking = false,
}: {
  readonly modules: readonly SettingsModule[];
  /** People is asleep or still waking: the settings wait for it (`components/waking.tsx`). */
  readonly waking?: boolean;
}): JSX.Element {
  // The search is in the address (`?q=`), once typing rests: a link to
  // "the settings about Slack" opens with them found.
  const held = useSearchParams().get('q') ?? '';
  const [query, setQuery] = useState(held);
  const sent = useRef(held);
  useEffect(() => {
    if (held === sent.current) return;
    sent.current = held;
    setQuery(held);
  }, [held]);
  useEffect(() => {
    if (query === sent.current) return undefined;
    const timer = setTimeout(() => {
      sent.current = query;
      noteInAddress({ q: query.trim() === '' ? null : query }, 'replace');
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);
  const [active, setActive] = useState(modules[0]?.key);
  const needle = query.trim().toLowerCase();
  const module = modules.find((m) => m.key === active) ?? modules[0];
  const attention = modules.flatMap((m) =>
    m.settings.filter((s) => s.attention !== null).map((s) => ({ ...s, module: m.key })),
  );
  const shown =
    module?.settings.filter(
      (s) =>
        needle === '' ||
        s.label.toLowerCase().includes(needle) ||
        (s.description ?? '').toLowerCase().includes(needle) ||
        (s.now ?? '').toLowerCase().includes(needle),
    ) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="@3xl/page:pe-64"
        title="Settings"
        description="How your company’s workspace works. Open a setting to see it in full and change it."
      />
      <Waking area="People" waking={waking}>
        {waking ? null : modules.length === 0 || module === undefined ? (
          <EmptyState
            icon={<icons.settings />}
            title="Nothing here for you to change"
            description="Settings are for your company’s administrators and HR. Ask one of them if something needs changing."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2.5 @3xl/page:pe-64">
              <SearchField
                size="sm"
                label="Find a setting"
                placeholder="Find a setting, like “numbering” or “Slack”"
                value={query}
                onValueChange={setQuery}
                containerClassName="w-full max-w-[26rem]"
              />
              {attention.map((a) => (
                <Chip
                  key={a.path}
                  startIcon={<icons.warning aria-hidden />}
                  onClick={() => {
                    window.location.assign(a.path);
                  }}
                >
                  {a.attention?.chip}
                </Chip>
              ))}
            </div>
            <div className="grid gap-8 @3xl/page:grid-cols-[13.75rem_minmax(0,1fr)]">
              <TertiaryNav
                label="Settings areas"
                variant="fill"
                current="page"
                items={modules.map((m) => ({ id: m.key, label: m.title, href: `#${m.key}` }))}
                {...(module.key === '' ? {} : { activeId: module.key })}
                onSelect={setActive}
                touchLayout="pills"
              />
              <section id={module.key} aria-labelledby={`${module.key}-title`} className="min-w-0">
                <h2 id={`${module.key}-title`} className="font-display text-xl font-bold text-fg">
                  {module.title}
                </h2>
                <p className="mt-1.5 mb-4.5 max-w-prose text-sm text-fg-muted">
                  {module.description}
                </p>
                {shown.length === 0 ? (
                  <EmptyState
                    icon={<icons.search />}
                    title={`No setting matches “${query.trim()}”`}
                    description="Try another word, or browse the areas on the left."
                  />
                ) : (
                  <ul className="grid gap-3.5 @5xl/page:grid-cols-2">
                    {shown.map((s) => (
                      <li key={s.path} className="min-w-0">
                        <SettingsCard
                          href={s.path}
                          icon={<Icon name={s.icon} />}
                          title={s.label}
                          description={s.description}
                          meta={
                            // Still to come, while the page is fetched (`PageLoading`).
                            s.now === '' ? (
                              <Skeleton className="inline-block h-3.5 w-44 max-w-full align-middle" />
                            ) : (
                              (s.now ?? undefined)
                            )
                          }
                          badge={
                            s.attention === null ? undefined : (
                              <Badge size="sm" tone="warning">
                                {s.attention.badge}
                              </Badge>
                            )
                          }
                          className="h-full"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </Waking>
    </div>
  );
}
