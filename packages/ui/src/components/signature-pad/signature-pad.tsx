'use client';

import { useRef, useState, type JSX, type PointerEvent } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';

/**
 * A signature drawn with a pointer: a mouse, a finger, a pen.
 *
 * ### The strokes, not a picture
 *
 * What comes out is an SVG path (`M x y L x y …`) in a fixed 400 × 120 box,
 * so it scales to wherever it is shown again and stores as a few kilobytes of
 * text, not an image somebody has to keep.
 *
 * ### Never the only way
 *
 * Drawing needs a pointer. A screen that offers this also offers typing a
 * name, which is the accessible path and a signature in its own right; this
 * component says so to a screen reader rather than pretending to be a field
 * it is not.
 */

export interface SignaturePadProps {
  /** The strokes so far, as an SVG path; empty when nothing is drawn. */
  readonly value: string;
  readonly onValueChange: (path: string) => void;
  /** What a screen reader hears: "Draw your signature". */
  readonly label: string;
  readonly clearLabel?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

const WIDTH = 400;
const HEIGHT = 120;

export function SignaturePad({
  value,
  onValueChange,
  label,
  clearLabel = 'Clear',
  disabled = false,
  className,
}: SignaturePadProps): JSX.Element {
  const ref = useRef<SVGSVGElement>(null);
  const [drawing, setDrawing] = useState(false);
  const point = (event: PointerEvent<SVGSVGElement>): string => {
    const box = ref.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return '0 0';
    const x = ((event.clientX - box.left) / box.width) * WIDTH;
    const y = ((event.clientY - box.top) / box.height) * HEIGHT;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  };
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <svg
        ref={ref}
        role="img"
        aria-label={value === '' ? label : `${label}: drawn`}
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        className={cn(
          'h-28 w-full touch-none rounded-lg bg-surface-sunken text-fg',
          disabled ? 'opacity-50' : 'cursor-crosshair',
        )}
        onPointerDown={(event) => {
          if (disabled) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrawing(true);
          onValueChange(`${value} M ${point(event)}`.trim());
        }}
        onPointerMove={(event) => {
          if (!drawing) return;
          onValueChange(`${value} L ${point(event)}`);
        }}
        onPointerUp={() => {
          setDrawing(false);
        }}
        onPointerCancel={() => {
          setDrawing(false);
        }}
      >
        <line
          x1="24"
          x2={WIDTH - 24}
          y1={HEIGHT - 24}
          y2={HEIGHT - 24}
          className="stroke-border-strong"
          strokeWidth="1"
        />
        <path
          d={value === '' ? undefined : value}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled || value === ''}
          onClick={() => {
            onValueChange('');
          }}
        >
          {clearLabel}
        </Button>
      </div>
    </div>
  );
}
