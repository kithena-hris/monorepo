import { Badge, Button, CheckboxCard, IconList, IconListItem, IconTile, icons } from '@reach/ui';
import type { ComponentType, JSX, ReactNode, SVGProps } from 'react';

import type { BenefitCategory, CatalogueBenefit } from './types';

/**
 * Benefits by category: the tiles a job picks from, and the list its ad
 * shows. A category leads with its icon and its name; within it, every
 * benefit is a title and a line a candidate reads. Statutory ones are in
 * every job, locked, and say why.
 */

type Glyph = ComponentType<SVGProps<SVGSVGElement>>;

/** A category's icon by its name in Reach; a star for one Reach does not have. */
export function CategoryIcon({
  icon,
  className,
}: {
  readonly icon: string;
  readonly className?: string;
}): JSX.Element {
  const Icon =
    (icons as unknown as Readonly<Record<string, Glyph | undefined>>)[icon] ?? icons.starred;
  return <Icon aria-hidden className={className} />;
}

/** The categories that have benefits, in the catalogue's order, each with its benefits. */
export function grouped<T extends { readonly category: string }>(
  benefits: readonly T[],
  categories: readonly BenefitCategory[],
): { readonly category: BenefitCategory; readonly benefits: readonly T[] }[] {
  const known = categories.map((category) => ({
    category,
    benefits: benefits.filter((b) => b.category === category.key),
  }));
  const strays = benefits.filter((b) => !categories.some((c) => c.key === b.category));
  return [
    ...known,
    ...(strays.length === 0
      ? []
      : [
          {
            category: { key: 'other', name: 'Other perks', icon: 'more', custom: false },
            benefits: strays,
          },
        ]),
  ].filter((g) => g.benefits.length > 0);
}

export function CategoryHeading({
  category,
  meta,
  action,
}: {
  readonly category: BenefitCategory;
  readonly meta?: ReactNode;
  readonly action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <IconTile tone="accent" size="lg">
        <CategoryIcon icon={category.icon} />
      </IconTile>
      <h3 className="text-md font-semibold text-fg">{category.name}</h3>
      {meta}
      {action === undefined ? null : <div className="ms-auto">{action}</div>}
    </div>
  );
}

/**
 * The tiles a job picks its benefits from: every category with its icon,
 * every benefit in it a tile with a title and a line, as many chosen as
 * suit. Choosing all of a category is one press.
 */
export function BenefitPicker({
  benefits,
  categories,
  chosen,
  onChange,
  disabled = false,
}: {
  readonly benefits: readonly CatalogueBenefit[];
  readonly categories: readonly BenefitCategory[];
  readonly chosen: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-8">
      {grouped(benefits, categories).map(({ category, benefits: list }) => {
        const optional = list.filter((b) => !b.statutory);
        const on = list.filter((b) => b.statutory || chosen.includes(b.id)).length;
        const all = optional.every((b) => chosen.includes(b.id));
        return (
          <section key={category.key} aria-label={category.name} className="flex flex-col gap-3">
            <CategoryHeading
              category={category}
              meta={
                on === 0 ? null : (
                  <Badge size="sm" variant="soft" tone="accent" className="tabular-nums">
                    {`${String(on)} of ${String(list.length)}`}
                  </Badge>
                )
              }
              action={
                optional.length < 2 ? undefined : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => {
                      const ids = optional.map((b) => b.id);
                      onChange(
                        all
                          ? chosen.filter((id) => !ids.includes(id))
                          : [...new Set([...chosen, ...ids])],
                      );
                    }}
                  >
                    {all ? 'Clear these' : 'Choose all'}
                  </Button>
                )
              }
            />
            <div role="group" aria-label={category.name} className="grid gap-3 sm:grid-cols-2">
              {list.map((b) => (
                <CheckboxCard
                  key={b.id}
                  checked={b.statutory || chosen.includes(b.id)}
                  disabled={b.statutory || disabled}
                  description={b.description ?? undefined}
                  badge={
                    b.statutory ? (
                      <Badge size="xs" variant="soft" tone="info">
                        By law
                      </Badge>
                    ) : undefined
                  }
                  onCheckedChange={(next) => {
                    onChange(
                      next === true ? [...chosen, b.id] : chosen.filter((id) => id !== b.id),
                    );
                  }}
                >
                  {b.name}
                </CheckboxCard>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** The benefits as the ad shows them: by category, each a title and a line. */
export function BenefitList({
  benefits,
  categories,
}: {
  readonly benefits: readonly CatalogueBenefit[];
  readonly categories: readonly BenefitCategory[];
}): JSX.Element {
  return (
    <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
      {grouped(benefits, categories).map(({ category, benefits: list }) => (
        <section key={category.key} className="flex flex-col gap-3">
          <CategoryHeading category={category} />
          <IconList>
            {list.map((b) => (
              <IconListItem
                key={b.id}
                icon={<icons.success aria-hidden />}
                tone="accent"
                {...(b.description === null ? {} : { description: b.description })}
              >
                {b.name}
              </IconListItem>
            ))}
          </IconList>
        </section>
      ))}
    </div>
  );
}
