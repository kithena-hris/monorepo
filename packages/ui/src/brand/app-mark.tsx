import type { JSX, SVGProps } from 'react';

import { cn } from '../lib/cn';

/**
 * Another product's mark, where a screen connects to it: "Connected to Slack",
 * a notice that goes there, a button that adds the app.
 *
 * A mark and not an icon, which is why it is here and not in `icons`: it is
 * the other company's, drawn as its guidelines ask — its own colours, never
 * recoloured, never re-drawn in the icon stroke. `tone="mono"` is the one
 * exception those guidelines allow, for a surface where full colour would
 * fight (a busy toolbar, a monochrome print), and it follows `currentColor`.
 *
 * The list is of products, not of who asks: a screen passes `app="slack"`
 * and the system knows nothing about why. Adding one is adding its drawing.
 */

export type ThirdPartyApp = 'slack';

export interface AppMarkProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  readonly app: ThirdPartyApp;
  /** `brand`: the app's own colours. `mono`: `currentColor`, where colour would fight. */
  readonly tone?: 'brand' | 'mono';
  /** Names the mark where it stands alone; decorative beside the app's name. */
  readonly title?: string;
}

/** The Slack mark, its four colours, on Slack's own 122.8 grid. */
const SLACK: readonly { readonly d: string; readonly fill: string }[] = [
  {
    d: 'M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z',
    fill: '#E01E5A',
  },
  {
    d: 'M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z',
    fill: '#36C5F0',
  },
  {
    d: 'M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z',
    fill: '#2EB67D',
  },
  {
    d: 'M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z',
    fill: '#ECB22E',
  },
];

const DRAWINGS: Record<ThirdPartyApp, { readonly viewBox: string; readonly paths: typeof SLACK }> = {
  slack: { viewBox: '0 0 122.8 122.8', paths: SLACK },
};

export function AppMark({ app, tone = 'brand', title, className, ...props }: AppMarkProps): JSX.Element {
  const drawing = DRAWINGS[app];
  return (
    <svg
      viewBox={drawing.viewBox}
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img' })}
      className={cn('size-5 shrink-0', className)}
      {...props}
    >
      {title === undefined ? null : <title>{title}</title>}
      {drawing.paths.map((p) => (
        <path key={p.d} d={p.d} fill={tone === 'mono' ? 'currentColor' : p.fill} />
      ))}
    </svg>
  );
}
