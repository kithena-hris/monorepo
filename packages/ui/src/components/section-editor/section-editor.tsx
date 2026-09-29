'use client';

import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { TertiaryNav, type TertiaryNavStatus } from '../nav/nav';

/**
 * A long edit on one page, with a list of its sections beside it.
 *
 * The step-by-step wizard asks for three "Next"s before the part the reader
 * came to change, and hides whether the rest is fine. This keeps every
 * section on one scrolling page, lists them beside it with a status each
 * (done, needs attention), follows the reader's scroll, and jumps straight to
 * a section when it is chosen. Saving is the caller's footer, always there,
 * rather than the prize at the end of the steps.
 *
 * Three columns at a desk: the list, the sections, and an `aside` for a live
 * preview or a plain-words summary of what the choices add up to. Under a
 * finger the list becomes a scrolling row of pills over the sections and the
 * aside follows them, because a phone has one column.
 *
 * Put it in a `SheetBody` (or anywhere with a bounded height): the sections
 * scroll inside it and the list stays put.
 */
export interface SectionEditorSection {
  readonly id: string;
  readonly label: string;
  readonly status?: TertiaryNavStatus;
}

export interface SectionEditorProps extends ComponentPropsWithoutRef<'div'> {
  readonly sections: readonly SectionEditorSection[];
  /** Names the list: "Field sections". */
  readonly label: string;
  /** The preview or the summary, beside the sections. */
  readonly aside?: ReactNode;
  /** `SectionEditorPart`s, one per entry in `sections`. */
  readonly children: ReactNode;
}

export function SectionEditor({
  sections,
  label,
  aside,
  children,
  className,
  ...props
}: SectionEditorProps): JSX.Element {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(sections[0]?.id);

  // The section nearest the top of the scroller is the one being edited.
  useEffect(() => {
    const root = scroller.current;
    if (root === null || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .toSorted((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top !== undefined) setActive(top.target.id);
      },
      { root, rootMargin: '0px 0px -60% 0px' },
    );
    for (const section of sections) {
      const node = root.querySelector(`#${CSS.escape(section.id)}`);
      if (node !== null) observer.observe(node);
    }
    return () => {
      observer.disconnect();
    };
  }, [sections]);

  return (
    <div
      className={cn('flex min-h-0 flex-1 gap-6 touch:flex-col touch:gap-4', className)}
      {...props}
    >
      <TertiaryNav
        label={label}
        items={sections.map((s) => ({
          id: s.id,
          label: s.label,
          ...(s.status === undefined ? {} : { status: s.status }),
        }))}
        {...(active === undefined ? {} : { activeId: active })}
        variant="fill"
        touchLayout="pills"
        onSelect={setActive}
        className="w-48 shrink-0 touch:w-auto"
      />
      <div
        ref={scroller}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto scroll-smooth pe-1 motion-reduce:scroll-auto touch:overflow-visible touch:pe-0"
      >
        {children}
      </div>
      {aside ? (
        <div className="flex w-70 shrink-0 flex-col gap-3.5 overflow-y-auto touch:w-auto touch:overflow-visible">
          {aside}
        </div>
      ) : null}
    </div>
  );
}

/** One section of the page: its heading, its fields. The `id` matches its entry in `sections`. */
export function SectionEditorPart({
  id,
  title,
  description,
  children,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<'section'>, 'title'> & {
  readonly id: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
}): JSX.Element {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn('flex scroll-mt-2 flex-col gap-3.5', className)}
      {...props}
    >
      <div>
        <h3 id={`${id}-title`} className="font-display text-lg leading-tight font-bold text-fg">
          {title}
        </h3>
        {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
