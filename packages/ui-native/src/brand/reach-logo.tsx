import { useCssElement } from 'react-native-css';
import { Text as CssText, View } from 'react-native-css/components';
import Svg, { Circle, Path } from 'react-native-svg';

import { cn } from '../lib/cn.ts';
import { iconVariants, type IconProps } from '../components/icon/icon.tsx';

/**
 * The Reach mark, drawn as the web's: a figure leaning forward and the thing
 * it reaches for, which is also a lowercase r. One stroke with no corner in
 * it, round caps, and a gap: the reach has not landed. See `@reach/ui`'s
 * `reach-logo.tsx` for the reasoning; this is the same geometry.
 */

const mapping = { className: { target: 'style', nativeStyleMapping: { color: 'color' } } } as const;

/** Tile and glyph per tone, paired: each glyph colour is the one that clears contrast on its tile. */
const tileTone = {
  accent: { tile: 'bg-accent-solid', glyph: 'on-accent' },
  invert: { tile: 'bg-invert', glyph: 'on-invert' },
  light: { tile: 'bg-fg-on-accent', glyph: 'accent' },
} as const satisfies Record<string, { tile: string; glyph: NonNullable<IconProps['tone']> }>;

function Glyph({
  side,
  tone,
  tile,
}: {
  side: number;
  tone: NonNullable<IconProps['tone']>;
  tile: boolean;
}): React.JSX.Element {
  // On a tile the glyph sits on the 24 grid inside the 32 tile at a heavier
  // stroke, which a line reversed out of a saturated ground needs.
  return useCssElement(
    Svg,
    {
      width: side,
      height: side,
      viewBox: tile ? '-4 -4 32 32' : '0 0 24 24',
      fill: 'none',
      className: iconVariants({ tone }),
      children: [
        <Path
          key="reach"
          d="M6 20 V13 C6 8 10 4.6 14.2 6.2"
          stroke="currentColor"
          strokeWidth={tile ? 2.8 : 2.6}
          strokeLinecap="round"
        />,
        <Circle key="target" cx={18.5} cy={7.8} r={tile ? 2.1 : 1.9} fill="currentColor" />,
      ],
    },
    mapping,
  );
}

export type ReachMarkProps = {
  /** In points. */
  size?: number;
  /**
   * The app mark: the glyph reversed out of a tile whose corner is 9/32 of its
   * side at every size. `accent` is the brand tile, `invert` the one-colour
   * version, `light` a white tile for an accent ground. Without it, the bare
   * glyph in `tone`.
   */
  tile?: boolean | keyof typeof tileTone;
  /** The bare glyph's colour. */
  tone?: NonNullable<IconProps['tone']>;
  /** Names the mark where it is the only thing identifying the product. */
  title?: string;
  className?: string | undefined;
};

export function ReachMark({
  size = 32,
  tile = false,
  tone = 'default',
  title,
  className,
}: ReachMarkProps): React.JSX.Element {
  const a11y = title
    ? {
        accessible: true,
        accessibilityRole: 'image' as const,
        accessibilityLabel: title,
        role: 'img' as const,
      }
    : { accessible: false, 'aria-hidden': true };
  if (tile === false) {
    return (
      <View {...a11y} className={cn(className)}>
        <Glyph side={size} tone={tone} tile={false} />
      </View>
    );
  }
  const t = tileTone[tile === true ? 'accent' : tile];
  return (
    <View
      {...a11y}
      className={cn('items-center justify-center overflow-hidden', t.tile, className)}
      style={{ width: size, height: size, borderRadius: (size * 9) / 32 }}
    >
      <Glyph side={size} tone={t.glyph} tile />
    </View>
  );
}

/*
 * The lockup's proportions, from the design: the word two thirds of the
 * mark's height, the gap a little over a third.
 */
const lockupSize = { sm: 20, md: 32, lg: 56 } as const;

export type ReachLogoProps = {
  /** The mark's side: `sm` 20, `md` 32, `lg` 56, or points. */
  size?: keyof typeof lockupSize | number;
  /** The tile's tone. `light` on an accent ground, `invert` for one colour. */
  tone?: keyof typeof tileTone;
  /** The word's colour, to sit on an accent or inverted ground. */
  wordTone?: 'default' | 'on-accent' | 'on-invert';
  /** Adds the line that says what it is. */
  showSubtitle?: boolean;
  className?: string | undefined;
};

const wordClass = {
  default: 'text-fg',
  'on-accent': 'text-fg-on-accent',
  'on-invert': 'text-fg-on-invert',
} as const;

/** The lockup: the app mark and the word, set in the display face. Read as "Reach". */
export function ReachLogo({
  size = 'md',
  tone = 'accent',
  wordTone = 'default',
  showSubtitle = false,
  className,
}: ReachLogoProps): React.JSX.Element {
  const side = typeof size === 'number' ? size : lockupSize[size];
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Reach"
      role="img"
      aria-label="Reach"
      className={cn('flex-row items-center self-start', className)}
      style={{ gap: Math.round(side * 0.36) }}
    >
      <ReachMark size={side} tile={tone} />
      <View>
        <CssText
          className={cn('font-bold', wordClass[wordTone])}
          style={{
            fontSize: Math.round(side * 0.66),
            lineHeight: Math.round(side * 0.66),
            letterSpacing: -side * 0.66 * 0.02,
          }}
        >
          Reach
        </CssText>
        {showSubtitle ? (
          <CssText className="mt-1 text-caption font-medium tracking-[0.18em] text-fg-subtle uppercase">
            Design system
          </CssText>
        ) : null}
      </View>
    </View>
  );
}
