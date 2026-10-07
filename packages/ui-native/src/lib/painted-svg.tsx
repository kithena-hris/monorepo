import type { ReactNode } from 'react';
import Svg, { type SvgProps } from 'react-native-svg';

/**
 * An `Svg` that also hands its resolved colour to its children.
 *
 * react-native-svg resolves `currentColor` for a fill or a stroke, from the
 * `color` a `text-*` class maps onto the `Svg`, but not for a gradient's
 * `stopColor`: on a device every stop warns and paints nothing. So a gradient
 * is drawn from the colour itself. On the web the class reaches the DOM and no
 * `color` prop arrives, so the stops keep `currentColor`, which CSS resolves.
 *
 * Pass it to `useCssElement` with the `color` mapping, as `Icon` does.
 */
export function PaintedSvg({
  color,
  paint,
  ...svg
}: Omit<SvgProps, 'children'> & {
  paint: (color: string) => ReactNode;
}): React.JSX.Element {
  return (
    <Svg {...svg} {...(color === undefined ? {} : { color })}>
      {paint(typeof color === 'string' ? color : 'currentColor')}
    </Svg>
  );
}
