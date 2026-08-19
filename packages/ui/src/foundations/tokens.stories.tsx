import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

import { CopyButton } from '../components/clipboard/clipboard';

import {
  elevationTokens,
  motionDurations,
  motionEasings,
  primitiveColorScales,
  radiusScale,
  resolveToken,
  semanticColorTokens,
  typeScale,
} from '../tokens/index';

/*
 * The name lists are module constants, not values built during render. Rebuilt
 * per render they would be a new array identity every time, the effect below
 * would re-run, its `setValues` would render again, and the page would spin
 * until React gave up with "Maximum update depth exceeded".
 */
const semanticNames = Object.values(semanticColorTokens).flat();
const primitiveNames = Object.values(primitiveColorScales).flat();
const motionNames = [...motionDurations, ...motionEasings];

/**
 * Every value on this page is read from the live document rather than
 * duplicated in the story, so the documentation cannot drift from what ships.
 * Flip the theme in the toolbar and the numbers change with it.
 */
function useResolvedTokens(names: readonly string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const read = (): void => {
      setValues(Object.fromEntries(names.map((name) => [name, resolveToken(name)])));
    };
    read();

    // The theme decorator toggles a class on <html>; re-read when it changes.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      observer.disconnect();
    };
  }, [names]);

  return values;
}

function Swatch({ name, value }: { name: string; value: string }): JSX.Element {
  const label = name.replace(/^--reach-(color-)?/, '');
  return (
    <div className="group flex items-center gap-3">
      <div
        className="size-10 shrink-0 rounded-md ring-1 ring-border ring-inset"
        style={{ background: value }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs font-medium text-fg">{label}</p>
        <p className="truncate font-mono text-2xs text-fg-subtle">{value || '—'}</p>
      </div>
      {/* The token name, not the resolved value: a component consumes
          `var(--reach-color-accent)`, and pasting the OKLCH triple is how a
          hard-coded colour gets into a codebase. */}
      <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <CopyButton value={name} label={`Copy ${name}`} />
      </div>
    </div>
  );
}

/**
 * Tailwind scans source text for complete class names, so the scale classes are
 * written out rather than interpolated. An interpolated `text-${step}` compiles
 * to nothing.
 */
const textClass: Record<(typeof typeScale)[number], string> = {
  '2xs': 'text-2xs',
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
  md: 'text-md',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
  '3xl': 'text-3xl',
};

const radiusClass: Record<(typeof radiusScale)[number], string> = {
  xs: 'rounded-xs',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
};

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-md font-semibold text-fg">{title}</h3>
        {note ? <p className="mt-0.5 max-w-2xl text-sm text-fg-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

const meta = {
  title: 'Foundations/Tokens',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: [
          'Two layers. **Primitives** are raw values that no component may reference: renaming one is free. **Semantic** tokens are what components consume: renaming one is a breaking change.',
          '',
          'Theming re-points the semantic layer at different primitives. A component never learns which theme it is in.',
        ].join('\n'),
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SemanticColor: Story = {
  name: 'Semantic colour',
  render: function SemanticColorStory() {
    const values = useResolvedTokens(semanticNames);

    return (
      <div className="space-y-8">
        {Object.entries(semanticColorTokens).map(([group, tokens]) => (
          <Section key={group} title={group.charAt(0).toUpperCase() + group.slice(1)}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tokens.map((name) => (
                <Swatch key={name} name={name} value={values[name] ?? ''} />
              ))}
            </div>
          </Section>
        ))}
      </div>
    );
  },
};

export const PrimitiveScales: Story = {
  name: 'Primitive scales',
  parameters: {
    docs: {
      description: {
        story:
          'OKLCH, so a lightness step is a perceptual step: the same step reads as the same contrast at every hue. Components must not reference these directly.',
      },
    },
  },
  render: function PrimitiveScalesStory() {
    const values = useResolvedTokens(primitiveNames);

    return (
      <div className="space-y-8">
        {Object.entries(primitiveColorScales).map(([scale, tokens]) => (
          <Section key={scale} title={scale}>
            <div className="flex flex-wrap gap-2">
              {tokens.map((name) => (
                <div key={name} className="w-20 space-y-1.5">
                  <div
                    className="h-14 rounded-md ring-1 ring-border ring-inset"
                    style={{ background: values[name] }}
                  />
                  <p className="font-mono text-2xs text-fg-subtle">{name.split('-').pop()}</p>
                </div>
              ))}
            </div>
          </Section>
        ))}
      </div>
    );
  },
};

export const Type: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'One family. Tabular figures are a hard requirement, not a taste call: payroll and leave balances are read in columns, and proportional digits make a column of money unscannable.',
      },
    },
  },
  render: () => (
    <div className="space-y-6">
      <Section title="Scale">
        <div className="space-y-3">
          {typeScale.map((step) => (
            <div key={step} className="flex items-baseline gap-6 border-b border-border pb-3">
              <code className="w-16 shrink-0 font-mono text-2xs text-fg-subtle">{step}</code>
              <p className={`${textClass[step]} text-fg`}>Effective from 1 September 2026</p>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Figures" note="Left: tabular, as shipped. Right: proportional, for contrast.">
        <div className="grid max-w-md grid-cols-2 gap-6 text-md">
          <div className="tabular-nums">
            <p>4,200.50</p>
            <p>1,118.00</p>
            <p>11,911.75</p>
          </div>
          <div className="[font-variant-numeric:proportional-nums]">
            <p>4,200.50</p>
            <p>1,118.00</p>
            <p>11,911.75</p>
          </div>
        </div>
      </Section>
    </div>
  ),
};

export const Elevation: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Two shadows each, a tight contact shadow plus a soft ambient one. A single blurred shadow reads as fog. In dark mode shadows carry almost nothing, so elevation is carried by surface lightness instead.',
      },
    },
  },
  render: function ElevationStory() {
    const values = useResolvedTokens(elevationTokens);
    return (
      <div className="flex flex-wrap gap-6">
        {elevationTokens.map((name) => (
          <div key={name} className="space-y-2">
            <div
              className="grid size-28 place-items-center rounded-lg border border-border bg-surface"
              style={{ boxShadow: values[name] }}
            >
              <code className="font-mono text-2xs text-fg-subtle">
                {name.replace('--reach-shadow-', '')}
              </code>
            </div>
          </div>
        ))}
      </div>
    );
  },
};

export const Shape: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-4">
      {radiusScale.map((step) => (
        <div key={step} className="space-y-2 text-center">
          <div className={`size-20 border border-border bg-surface-sunken ${radiusClass[step]}`} />
          <code className="font-mono text-2xs text-fg-subtle">{step}</code>
        </div>
      ))}
    </div>
  ),
};

export const Motion: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Interface motion is confirmation, not decoration. Nothing here is long enough to wait for, and every value collapses under `prefers-reduced-motion`.',
      },
    },
  },
  render: function MotionStory() {
    const values = useResolvedTokens(motionNames);
    return (
      <div className="space-y-8">
        <Section title="Duration">
          <div className="grid gap-2 sm:grid-cols-2">
            {motionDurations.map((name) => (
              <div
                key={name}
                className="flex items-center justify-between gap-4 border-b border-border pb-2"
              >
                <code className="font-mono text-xs text-fg">
                  {name.replace('--animate-duration-', '')}
                </code>
                <code className="font-mono text-xs text-fg-subtle">{values[name]}</code>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Easing">
          <div className="grid gap-2">
            {motionEasings.map((name) => (
              <div
                key={name}
                className="flex items-center justify-between gap-4 border-b border-border pb-2"
              >
                <code className="font-mono text-xs text-fg">{name.replace('--ease-', '')}</code>
                <code className="font-mono text-xs text-fg-subtle">{values[name]}</code>
              </div>
            ))}
          </div>
        </Section>
      </div>
    );
  },
};
