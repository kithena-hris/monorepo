import type { Meta, StoryObj } from '@storybook/react-vite';
import { Fragment, useEffect, useState, type JSX, type ReactNode } from 'react';

import { CopyButton } from '../components/clipboard/clipboard';
import { AutoGrid } from '../components/layout/layout';

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
const radiusNames = [...radiusScale.map((step) => `--radius-${step}`), '--reach-radius-control'];

/** A CSS time as milliseconds: `200ms` or `0.2s`. Empty until the page has read it. */
function toMs(value: string | undefined): number {
  const number = Number.parseFloat(value ?? '');
  if (Number.isNaN(number)) return 0;
  return value?.trim().endsWith('ms') ? number : number * 1000;
}

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

/**
 * A tile, then the name, then the token. The tile is large enough to judge a
 * colour by, which a 40px dot beside the text was not, and the hairline ring
 * keeps a canvas-coloured swatch visible against the canvas.
 */
function Swatch({ name, value }: { name: string; value: string }): JSX.Element {
  const label = name.replace(/^--reach-(color-)?/, '');
  return (
    <div className="group flex min-w-0 flex-col gap-2">
      <div className="relative">
        <div
          className="h-14 rounded-sm ring-1 ring-border ring-inset"
          style={{ background: value }}
        />
        {/* The token name, not the resolved value: a component consumes
            `var(--reach-color-accent)`, and pasting the OKLCH triple is how a
            hard-coded colour gets into a codebase. Always shown under a
            finger, where there is no hover to reveal it. */}
        <div className="absolute end-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100">
          <CopyButton value={name} label={`Copy ${name}`} />
        </div>
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-fg">{label}</p>
        <p className="truncate font-mono text-2xs text-fg-muted">{value || '—'}</p>
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

/** What each elevation step is for, in the order the scale climbs. */
const elevationUse: Record<(typeof elevationTokens)[number], string> = {
  '--reach-shadow-xs': 'A pressed or resting control',
  '--reach-shadow-sm': 'Cards and lists on the canvas',
  '--reach-shadow-md': 'Popovers, menus, a tab bar',
  '--reach-shadow-lg': 'Sheets and the phone frame',
  '--reach-shadow-xl': 'Dialogs, the top of the stack',
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
        <h3 className="font-display text-md font-bold tracking-tight text-fg">{title}</h3>
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
  parameters: {
    docs: {
      description: {
        story:
          'Fills, not borders: a field, a secondary button and a hover state are all a step of `surface`, and a line is drawn only where two surfaces of the same colour meet. Each status has a soft fill, a `-fg` for text on it, and a `-solid` that carries white text.',
      },
    },
  },
  render: function SemanticColorStory() {
    const values = useResolvedTokens(semanticNames);

    return (
      <div className="space-y-8">
        {Object.entries(semanticColorTokens).map(([group, tokens]) => (
          <Section key={group} title={group.charAt(0).toUpperCase() + group.slice(1)}>
            <AutoGrid minItemWidth="9rem" gap={3}>
              {tokens.map((name) => (
                <Swatch key={name} name={name} value={values[name] ?? ''} />
              ))}
            </AutoGrid>
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
      <div className="space-y-3">
        {Object.entries(primitiveColorScales).map(([scale, tokens]) => (
          // One row per scale, the steps as equal columns, so the ramps line up
          // and a step can be compared across hues at a glance.
          <div
            key={scale}
            className="grid items-center gap-1"
            style={{
              gridTemplateColumns: `5.5rem repeat(${String(tokens.length)}, minmax(0, 1fr))`,
            }}
          >
            <span className="text-xs font-semibold text-fg-muted capitalize">{scale}</span>
            {tokens.map((name) => (
              <span
                key={name}
                title={name}
                className="h-9 rounded-xs ring-1 ring-border ring-inset touch:h-7"
                style={{ background: values[name] }}
              />
            ))}
          </div>
        ))}
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `5.5rem repeat(12, minmax(0, 1fr))` }}
          aria-hidden
        >
          <span />
          {primitiveColorScales.neutral.map((name) => (
            <span key={name} className="text-center font-mono text-2xs text-fg-muted">
              {name.split('-').pop()}
            </span>
          ))}
        </div>
      </div>
    );
  },
};

export const Type: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The platform’s own face: SF on Apple devices, Segoe on Windows, with a display cut for headings where the platform has one. Under a finger `xs`, `sm` and `base` step up to 13, 15 and 17px on their own. Tabular figures are a hard requirement, not a taste call: payroll and leave balances are read in columns, and proportional digits make a column of money unscannable.',
      },
    },
  },
  render: () => (
    <div className="space-y-6">
      <Section title="Scale">
        <div className="space-y-3">
          {typeScale.map((step) => (
            <div key={step} className="flex items-baseline gap-6 border-b border-border pb-3">
              <code className="w-16 shrink-0 font-mono text-2xs text-fg-muted">{step}</code>
              <p
                className={`${textClass[step]} min-w-0 text-fg ${
                  step === '2xl' || step === '3xl' || step === 'xl'
                    ? 'font-display font-bold tracking-tight'
                    : ''
                }`}
              >
                Effective from 1 September 2026
              </p>
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
          'Two shadows each, a tight contact shadow plus a soft ambient one. A single blurred shadow reads as fog. In dark mode shadows carry almost nothing, so elevation is carried by surface lightness instead: `surface-raised` is what a dialog or a sheet sits on. **Glass** is the one material: a translucent `glass` fill, a blur behind it and a `glass-line` hairline, for chrome the page scrolls under.',
      },
    },
  },
  render: function ElevationStory() {
    const values = useResolvedTokens(elevationTokens);
    return (
      <div className="space-y-8">
        <AutoGrid minItemWidth="9rem" gap={6}>
          {elevationTokens.map((name) => (
            <div key={name} className="space-y-2">
              <div
                className={`grid h-24 place-items-center rounded-lg ${
                  name === '--reach-shadow-xl' || name === '--reach-shadow-lg'
                    ? 'bg-surface-raised'
                    : 'bg-surface'
                }`}
                style={{ boxShadow: values[name] }}
              >
                <code className="font-mono text-xs text-fg">
                  {name.replace('--reach-shadow-', 'shadow-')}
                </code>
              </div>
              <p className="text-xs text-fg-muted">{elevationUse[name]}</p>
            </div>
          ))}
        </AutoGrid>

        <Section
          title="Glass"
          note="Over content, so the blur has something to do. The bar keeps its text legible whatever scrolls beneath it, and falls back to an opaque surface where a browser cannot blur."
        >
          <div className="relative h-44 overflow-hidden rounded-lg bg-canvas">
            <div aria-hidden className="absolute inset-0 flex gap-3 p-4">
              <span className="h-full flex-1 rounded-md bg-chart-1" />
              <span className="h-3/4 flex-1 self-end rounded-md bg-chart-2" />
              <span className="h-1/2 flex-1 self-end rounded-md bg-chart-3" />
              <span className="h-5/6 flex-1 self-end rounded-md bg-chart-4" />
              <span className="h-2/3 flex-1 self-end rounded-md bg-chart-5" />
            </div>
            <div
              data-material="chrome"
              className="absolute inset-x-3 bottom-3 flex h-12 items-center justify-between gap-3 rounded-full border border-glass-line bg-surface px-5 shadow-md backdrop-blur-material backdrop-saturate-(--reach-material-saturate) supports-[backdrop-filter]:bg-glass"
            >
              <span className="shrink-0 text-sm font-semibold text-fg">bg-glass</span>
              <span className="min-w-0 truncate font-mono text-xs text-fg">
                border-glass-line · shadow-md
              </span>
            </div>
          </div>
        </Section>
      </div>
    );
  },
};

export const Shape: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Soft, and concentric: a card at `lg` holds a field at `md`, and the inner radius is the outer one less the padding between them. Every control is a pill (`rounded-control`), so a button, a field and a segmented control share one silhouette at any height.',
      },
    },
  },
  render: function ShapeStory() {
    const values = useResolvedTokens(radiusNames);
    return (
      <div className="space-y-8">
        <div className="flex flex-wrap items-end gap-4">
          {radiusScale.map((step) => (
            <div key={step} className="space-y-2 text-center">
              <div className={`size-20 bg-surface-sunken ${radiusClass[step]}`} />
              <p className="font-mono text-xs text-fg">{step}</p>
              <p className="font-mono text-2xs text-fg-muted">{values[`--radius-${step}`]}</p>
            </div>
          ))}
        </div>
        <Section title="Controls" note="`rounded-control`, the same at every control height.">
          <div className="flex flex-wrap items-center gap-3">
            <span className="h-control-sm w-24 rounded-control bg-surface-sunken" />
            <span className="h-control-md w-32 rounded-control bg-surface-sunken" />
            <span className="h-control-lg w-40 rounded-control bg-accent-solid" />
            <code className="font-mono text-2xs text-fg-muted">
              {values['--reach-radius-control']}
            </code>
          </div>
        </Section>
      </div>
    );
  },
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
          {/* A bar per step, its length the duration, so the scale is read as
              proportions rather than as four numbers. */}
          <div className="grid grid-cols-[6rem_minmax(0,1fr)_4rem] items-center gap-x-3 gap-y-3">
            {motionDurations.map((name) => (
              <Fragment key={name}>
                <code className="font-mono text-xs text-fg">
                  {name.replace('--animate-duration-', '')}
                </code>
                <span
                  className="h-2 rounded-full bg-accent-solid"
                  style={{ width: `${String(Math.min(100, (toMs(values[name]) / 480) * 100))}%` }}
                />
                <code className="text-end font-mono text-xs text-fg-muted">{values[name]}</code>
              </Fragment>
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
                <code className="min-w-0 truncate font-mono text-xs text-fg-muted">
                  {values[name]}
                </code>
              </div>
            ))}
          </div>
        </Section>
      </div>
    );
  },
};
