import { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useCssElement } from 'react-native-css';
import { Text as CssText, View } from 'react-native-css/components';
import Svg, { Path } from 'react-native-svg';

import { cn } from '../../lib/cn.ts';

/**
 * A signature as it is shown, the web's `Signature`: typed in one of three
 * handwriting faces, or drawn (`SignaturePad`'s strokes), always in the middle
 * of its box and as large as the box allows.
 *
 * ### The faces
 *
 * Great Vibes, Sacramento and Mr Dafoe (OFL), the web's and the signed PDF's.
 * Reach names them (`SIGNATURE_FONTS`); the app loads its own copies under
 * those names (`expo-font`'s `useFonts`), as it does any font it ships. Until
 * they are in, a typed name shows in the system's face.
 */

export type SignatureStyle = 'flowing' | 'light' | 'bold';

export type SignatureValue =
  | { readonly kind: 'typed'; readonly text: string; readonly style?: SignatureStyle }
  | { readonly kind: 'drawn'; readonly path: string };

export const SIGNATURE_STYLE_LABEL: Readonly<Record<SignatureStyle, string>> = {
  flowing: 'Flowing',
  light: 'Light',
  bold: 'Bold',
};

/** The family each face is loaded under: Great Vibes, Sacramento, Mr Dafoe. */
export const SIGNATURE_FONTS: Readonly<Record<SignatureStyle, string>> = {
  flowing: 'ReachSignatureFlowing',
  light: 'ReachSignatureLight',
  bold: 'ReachSignatureBold',
};

/** How wide a letter of these faces runs, in ems: a typed name is sized from it. */
const EM_PER_LETTER = 0.5;

export interface SignatureProps {
  readonly value: SignatureValue;
  /** Initials rather than the whole name, for an initials box. */
  readonly initials?: boolean;
  /** What a screen reader hears: "Ada Lovelace's signature". */
  readonly label: string;
  /** The ink: `text-fg` by default; on a page, which is paper in either theme, the light theme's. */
  readonly className?: string | undefined;
}

const mapping = { className: { target: 'style', nativeStyleMapping: { color: 'color' } } } as const;

export function Signature({
  value,
  initials = false,
  label,
  className,
}: SignatureProps): React.JSX.Element {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const ink = value.kind === 'drawn' ? inkOf(value.path) : null;
  const pad = ink === null ? 0 : Math.max(ink.width, ink.height) * 0.06;
  const drawing = useCssElement(
    Svg,
    {
      width: '100%',
      height: '100%',
      viewBox:
        ink === null
          ? '0 0 400 120'
          : `${String(ink.x - pad)} ${String(ink.y - pad)} ${String(ink.width + pad * 2)} ${String(ink.height + pad * 2)}`,
      preserveAspectRatio: 'xMidYMid meet',
      className: cn('text-fg', className),
      children:
        value.kind === 'drawn' ? (
          <Path
            d={value.path}
            fill="none"
            stroke="currentColor"
            strokeWidth={ink === null ? 2.5 : Math.max(ink.width, ink.height) / 110}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null,
    },
    mapping,
  );
  const text = value.kind === 'typed' ? (initials ? initialsOf(value.text) : value.text) : '';
  const letters = Math.max(Array.from(text).length, 2);
  // At most about half the box's height (a handwriting face's capitals and
  // tails run well above and below it), and never wider than it.
  const size = Math.min(box.height * 0.56, (box.width * 0.9) / (letters * EM_PER_LETTER));
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      className="h-full w-full items-center justify-center overflow-hidden"
      onLayout={(e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout;
        setBox({ width, height });
      }}
    >
      {value.kind === 'drawn' ? (
        drawing
      ) : box.width === 0 ? null : (
        <CssText
          aria-hidden
          numberOfLines={1}
          className={cn('text-fg', className)}
          style={{
            fontFamily: SIGNATURE_FONTS[value.style ?? 'flowing'],
            fontSize: size,
            lineHeight: size * 1.6,
          }}
        >
          {text}
        </CssText>
      )}
    </View>
  );
}

const initialsOf = (name: string): string =>
  name
    .split(/\s+/u)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

/** Where a drawing's ink is in its 400 × 120 box; null for no ink. */
function inkOf(path: string): { x: number; y: number; width: number; height: number } | null {
  const n = path.match(/-?\d+(\.\d+)?/gu)?.map(Number) ?? [];
  if (n.length < 2) return null;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 1 < n.length; i += 2) {
    const x = n[i] ?? 0;
    const y = n[i + 1] ?? 0;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: Math.max(maxX - minX, 1), height: Math.max(maxY - minY, 1) };
}
