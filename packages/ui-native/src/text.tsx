import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { Text as CssText } from 'react-native-css/components';

/** The mobile type scale. Sizes and weights live in `global.css` as `--text-*`. */
export const textVariants = cva('', {
  variants: {
    variant: {
      large: 'text-large',
      title1: 'text-title1',
      title2: 'text-title2',
      title3: 'text-title3',
      headline: 'text-headline',
      body: 'text-body',
      callout: 'text-callout',
      subhead: 'text-subhead',
      footnote: 'text-footnote',
      caption: 'text-caption',
    },
    tone: {
      default: 'text-fg',
      muted: 'text-fg-muted',
      accent: 'text-accent-fg',
    },
  },
  defaultVariants: { variant: 'body', tone: 'default' },
});

const HEADINGS = new Set(['large', 'title1', 'title2', 'title3']);

export type TextProps = VariantProps<typeof textVariants> & {
  children?: ReactNode;
  className?: string;
};

export function Text({ variant, tone, className, children }: TextProps): React.JSX.Element {
  return (
    <CssText
      className={textVariants({ variant, tone, className })}
      {...(variant && HEADINGS.has(variant) ? { accessibilityRole: 'header' as const } : {})}
    >
      {children}
    </CssText>
  );
}
