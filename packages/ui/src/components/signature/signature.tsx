import type { JSX } from 'react';

import { cn } from '../../lib/cn';

/**
 * A signature as it is shown: typed in one of three handwriting faces, or
 * drawn (`SignaturePad`'s strokes), always in the middle of its box and as
 * large as the box allows.
 *
 * ### Sized without measuring
 *
 * A signature box is drawn many times on a page and while it is dragged, so
 * nothing here measures text. A typed name is sized by the box it is in
 * (container query units) and by its length, at the width a handwriting face
 * averages per letter; a drawing's `viewBox` is its ink, and SVG centres it.
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

/** The CSS family of each face (`styles/signature.css`). */
export const signatureFont = (style: SignatureStyle = 'flowing'): string =>
  `var(--font-signature-${style})`;

/** How wide a letter of these faces runs, in ems: a typed name is sized from it. */
const EM_PER_LETTER = 0.5;

export interface SignatureProps {
  readonly value: SignatureValue;
  /** Initials rather than the whole name, for an initials box. */
  readonly initials?: boolean;
  /** What a screen reader hears: "Ada Lovelace's signature". */
  readonly label: string;
  readonly className?: string;
}

export function Signature({
  value,
  initials = false,
  label,
  className,
}: SignatureProps): JSX.Element {
  if (value.kind === 'drawn') {
    const ink = inkOf(value.path);
    const pad = ink === null ? 0 : Math.max(ink.width, ink.height) * 0.06;
    return (
      <svg
        role="img"
        aria-label={label}
        viewBox={
          ink === null
            ? '0 0 400 120'
            : `${String(ink.x - pad)} ${String(ink.y - pad)} ${String(ink.width + pad * 2)} ${String(ink.height + pad * 2)}`
        }
        preserveAspectRatio="xMidYMid meet"
        className={cn('block size-full text-fg', className)}
      >
        <path
          d={value.path}
          fill="none"
          stroke="currentColor"
          strokeWidth={ink === null ? 2.5 : Math.max(ink.width, ink.height) / 110}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  const text = initials ? initialsOf(value.text) : value.text;
  const letters = Math.max(Array.from(text).length, 2);
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'grid size-full place-items-center overflow-hidden [container-type:size]',
        className,
      )}
    >
      <span
        aria-hidden
        className="leading-none whitespace-nowrap text-fg"
        style={{
          fontFamily: signatureFont(value.style),
          // At most about half the box's height (a handwriting face's capitals
          // and tails run well above and below it), and never wider than it.
          fontSize: `min(56cqh, calc(90cqw / ${String(letters * EM_PER_LETTER)}))`,
        }}
      >
        {text}
      </span>
    </span>
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
