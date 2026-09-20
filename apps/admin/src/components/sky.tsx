import { icons } from '@reach/ui';
import type { JSX } from 'react';

import type { Condition } from '../lib/place';

const SunIcon = icons.theme;
const MoonIcon = icons.themeDark;

/**
 * The sky over a company, as a band.
 *
 * **Nothing is written on it, and that is what lets it be bright.** The first
 * version put the company's figures on top of the sky, which forced every
 * gradient into the dark half to keep white text above 4.5:1 — so a sunny noon
 * rendered as dusk and the six conditions were hard to tell apart. Moving the
 * words underneath, onto the card's own surface, means this band can be the
 * blue a clear sky actually is, and the caption is legible in both themes
 * because it is ordinary text on `--reach-color-surface` rather than white on a
 * picture.
 *
 * Drawn rather than photographed. A real photograph of a customer's city needs
 * an image API, a key, and a second third party receiving a customer's location
 * — for a decoration. And a stock photo of the wrong city is a worse claim than
 * no photo. So the light and the weather are genuinely theirs; the skyline is
 * generic and says "a place", not "your place".
 *
 * A gradient with positioned elements rather than one SVG, because an SVG with
 * `slice` crops its short axis when the container is wider than the viewBox —
 * measured at about 5:1 here against a 2.5:1 viewBox, which cropped the sun out
 * of every daytime sky. A gradient fills any box exactly, the skyline is the
 * one thing allowed to stretch because a taller building is still a building,
 * and the sun and moon are icons so they cannot go oval.
 */
export function Sky({
  condition,
  isDay,
  className,
}: {
  readonly condition: Condition;
  readonly isDay: boolean;
  readonly className?: string;
}): JSX.Element {
  const [top, bottom] = GRADIENTS[condition][isDay ? 'day' : 'night'];
  // Overcast means overcast. A bright disc behind heavy rain is the one
  // combination that reads as a rendering fault rather than as weather.
  const lit = condition !== 'fog' && condition !== 'storm' && condition !== 'rain';
  const Light = isDay ? SunIcon : MoonIcon;

  return (
    <div
      aria-hidden
      className={`relative overflow-hidden ${className ?? ''}`}
      style={{ background: `linear-gradient(${top}, ${bottom})` }}
    >
      {isDay ? null : <Stars dim={condition !== 'clear'} />}

      {lit ? (
        <Light
          className="absolute top-3 right-5 size-12 sm:size-14"
          style={{
            // Yellow for the sun, and properly yellow. A pale disc on a blue
            // sky is the detail that decides whether this reads as a sky or as
            // a gradient with a shape on it.
            color: isDay ? '#facc15' : '#f1f5f9',
            filter: isDay
              ? 'drop-shadow(0 0 10px rgba(250,204,21,0.65))'
              : 'drop-shadow(0 0 8px rgba(226,232,240,0.45))',
            opacity: condition === 'clear' ? 1 : 0.85,
          }}
        />
      ) : null}

      {condition === 'clear' ? null : <Clouds condition={condition} isDay={isDay} />}
      {condition === 'rain' || condition === 'storm' || condition === 'snow' ? (
        <Precipitation frozen={condition === 'snow'} />
      ) : null}

      {/*
        Stretched on purpose. `none` distorts, and for a row of rectangles that
        is exactly what makes it work at any width. It is also why nothing round
        is drawn in here.
      */}
      <svg
        className="absolute inset-x-0 bottom-0 h-2/5 w-full"
        viewBox="0 0 400 60"
        preserveAspectRatio="none"
      >
        <path
          d="M0 60 L0 34 L22 34 L22 20 L40 20 L40 38 L58 38 L58 12 L76 12 L76 30 L96 30 L96 4
             L118 4 L118 26 L138 26 L138 38 L162 38 L162 16 L182 16 L182 32 L204 32 L204 8
             L226 8 L226 28 L248 28 L248 18 L268 18 L268 36 L292 36 L292 12 L314 12 L314 30
             L336 30 L336 22 L358 22 L358 38 L380 38 L380 26 L400 26 L400 60 Z"
          fill={isDay ? '#1e293b' : '#01040a'}
          opacity={isDay ? 0.45 : 0.75}
        />
      </svg>
    </div>
  );
}

/**
 * Sky colours, top to bottom, for each condition in each light.
 *
 * Literal hex rather than design tokens, and this is the one place in the
 * back-office where that is right: these are not interface colours. A storm is
 * not `--reach-color-warning` in a different mood, and putting a sky in the
 * token file would invite somebody to reuse "storm" for a button.
 *
 * The same values in both themes, deliberately. A sky does not get darker
 * because the operator prefers a dark interface, and a band that inverted would
 * make two people describing the same customer disagree about the weather.
 */
const GRADIENTS: Record<Condition, { day: [string, string]; night: [string, string] }> = {
  clear: { day: ['#1d6fe0', '#8fd4f7'], night: ['#050a1f', '#1c2f6b'] },
  cloud: { day: ['#4a90d9', '#b9c6d4'], night: ['#070b16', '#2b3853'] },
  fog: { day: ['#9aa3ab', '#d9d8d4'], night: ['#0f1113', '#3a3d42'] },
  rain: { day: ['#41566d', '#8fa3b8'], night: ['#04080f', '#25344a'] },
  snow: { day: ['#7b93ad', '#dde5ee'], night: ['#080d1b', '#333f5c'] },
  storm: { day: ['#232c3d', '#55637a'], night: ['#010308', '#141c2b'] },
};

/**
 * Stars, as percentages of the box.
 *
 * Fixed positions, not random: a background that reshuffles on every render is
 * a background somebody notices, and noticing it is the failure. Percentages
 * rather than pixels so they spread across whatever width the band has instead
 * of huddling in one corner of it.
 */
const STARS: readonly [number, number, number][] = [
  [7, 22, 2], [16, 52, 1.5], [24, 16, 2], [33, 44, 1.5], [42, 26, 2],
  [51, 58, 1.5], [59, 20, 2], [67, 48, 1.5], [88, 24, 2], [95, 52, 1.5],
  [11, 66, 1.5], [37, 12, 1.5], [73, 14, 2], [83, 62, 1.5],
];

function Stars({ dim }: { readonly dim: boolean }): JSX.Element {
  return (
    <div className="absolute inset-0" style={{ opacity: dim ? 0.35 : 1 }}>
      {STARS.map(([left, top, size]) => (
        <span
          key={`${String(left)}-${String(top)}`}
          className="absolute rounded-full bg-slate-50"
          style={{
            left: `${String(left)}%`,
            top: `${String(top)}%`,
            width: size,
            height: size,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Cloud, as overlapping discs.
 *
 * Positioned in percentages for the same reason as everything else here: it has
 * to hold its shape at any width. Coloured by the weather rather than always
 * white — white cloud on every sky was what made rain, fog and snow read as the
 * same grey picture, because the cloud was the brightest thing in all three and
 * the gradient behind it never got a word in.
 */
const PUFFS: readonly [number, number, number][] = [
  // Two clusters, each of three discs that overlap enough to merge into one
  // shape. Spread any wider and they read as separate blobs, which is what the
  // first spacing did — a cloud is a silhouette, not a row of circles.
  [9, 36, 46], [15, 22, 64], [23, 38, 42],
  [62, 26, 40], [68, 14, 56], [76, 30, 36],
];

function Clouds({
  condition,
  isDay,
}: {
  readonly condition: Condition;
  readonly isDay: boolean;
}): JSX.Element {
  const fill =
    condition === 'storm' ? '#0b1220' : condition === 'rain' ? (isDay ? '#7c8ea3' : '#2c3a4e') : '#f8fafc';
  const opacity = condition === 'fog' ? 0.5 : condition === 'storm' ? 0.85 : 0.8;

  return (
    <div className="absolute inset-0" style={{ opacity }}>
      {PUFFS.map(([left, top, size]) => (
        <span
          key={`${String(left)}-${String(top)}`}
          className="absolute rounded-full"
          style={{
            left: `${String(left)}%`,
            top: `${String(top)}%`,
            width: `${String(size)}px`,
            height: `${String(size)}px`,
            background: fill,
            // Just enough to lose the hard circle edge. Fog is the exception:
            // a fog bank has no edge at all, which is what makes it fog.
            filter: condition === 'fog' ? 'blur(14px)' : 'blur(5px)',
          }}
        />
      ))}
    </div>
  );
}

/**
 * Rain or snow.
 *
 * Without it, rain and storm were two grey gradients that differed only in the
 * word printed beneath them, which is not a difference anybody notices at a
 * glance — and a glance is the whole job.
 */
const DROPS: readonly [number, number][] = [
  [12, 18], [21, 46], [30, 12], [39, 38], [48, 22], [57, 50], [66, 16],
  [75, 40], [84, 26], [93, 14], [17, 62], [45, 64], [71, 58],
];

function Precipitation({ frozen }: { readonly frozen: boolean }): JSX.Element {
  return (
    <div className="absolute inset-0" style={{ opacity: frozen ? 0.9 : 0.6 }}>
      {DROPS.map(([left, top]) => (
        <span
          key={`${String(left)}-${String(top)}`}
          className={
            frozen
              ? 'absolute size-[3px] rounded-full bg-white'
              : 'absolute h-3.5 w-px -rotate-12 rounded-full bg-slate-100'
          }
          style={{ left: `${String(left)}%`, top: `${String(top)}%` }}
        />
      ))}
    </div>
  );
}
