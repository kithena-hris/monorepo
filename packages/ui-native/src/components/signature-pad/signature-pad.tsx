import { useState } from 'react';
import { useCssElement } from 'react-native-css';
import { View } from 'react-native-css/components';
import Svg, { Line, Path } from 'react-native-svg';

import { cn } from '../../lib/cn.ts';
import { Button } from '../button/button.tsx';

/**
 * A signature drawn with a finger: the web's `SignaturePad`, the same props.
 *
 * The strokes come out as an SVG path in a fixed 400 × 120 box, so the same
 * signature draws the same on a desk and a phone. Drawing needs a finger;
 * the screens that offer it offer typing a name beside it, the accessible
 * path and a signature in its own right.
 */
export type SignaturePadProps = {
  readonly value: string;
  readonly onValueChange: (path: string) => void;
  readonly label: string;
  readonly clearLabel?: string;
  readonly disabled?: boolean;
  readonly className?: string | undefined;
};

const WIDTH = 400;
const HEIGHT = 120;
const mapping = { className: { target: 'style', nativeStyleMapping: { color: 'color' } } } as const;

export function SignaturePad({
  value,
  onValueChange,
  label,
  clearLabel = 'Clear',
  disabled = false,
  className,
}: SignaturePadProps): React.JSX.Element {
  const [box, setBox] = useState({ width: WIDTH, height: HEIGHT });
  const point = (x: number, y: number): string =>
    `${((x / Math.max(1, box.width)) * WIDTH).toFixed(1)} ${((y / Math.max(1, box.height)) * HEIGHT).toFixed(1)}`;
  const drawing = useCssElement(
    Svg,
    {
      width: '100%',
      height: '100%',
      viewBox: `0 0 ${String(WIDTH)} ${String(HEIGHT)}`,
      className: 'text-fg',
      children: (
        <>
          <Line
            x1="24"
            x2={WIDTH - 24}
            y1={HEIGHT - 24}
            y2={HEIGHT - 24}
            stroke="currentColor"
            strokeOpacity={0.25}
            strokeWidth={1}
          />
          {value === '' ? null : (
            <Path
              d={value}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </>
      ),
    },
    mapping,
  );
  return (
    <View className={cn('gap-2', className)}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={value === '' ? label : `${label}: drawn`}
        className={cn('h-32 w-full rounded-lg bg-surface-sunken', disabled && 'opacity-50')}
        onLayout={(e) => {
          setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
        }}
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        onResponderGrant={(e) => {
          onValueChange(
            `${value} M ${point(e.nativeEvent.locationX, e.nativeEvent.locationY)}`.trim(),
          );
        }}
        onResponderMove={(e) => {
          onValueChange(`${value} L ${point(e.nativeEvent.locationX, e.nativeEvent.locationY)}`);
        }}
      >
        {drawing}
      </View>
      <View className="flex-row justify-end">
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled || value === ''}
          onPress={() => {
            onValueChange('');
          }}
        >
          {clearLabel}
        </Button>
      </View>
    </View>
  );
}
