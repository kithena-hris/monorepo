import { cva } from 'class-variance-authority';
import { User } from 'lucide-react-native';
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Image, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Icon, type IconProps, type LucideIcon } from '../icon/icon.tsx';

/** The web avatar's sizes, in points. A number is taken as it is. */
const SIZES = { xs: 20, sm: 24, md: 32, lg: 40, xl: 48, '2xl': 64, '3xl': 80 } as const;
export type AvatarSize = keyof typeof SIZES | number;

/** 44: a list row's avatar on a phone, the design's default. */
const DEFAULT_SIZE = 44;

const avatar = cva('items-center justify-center', {
  variants: {
    tone: {
      neutral: 'bg-surface-active',
      accent: 'bg-accent-subtle',
      info: 'bg-info-subtle',
      success: 'bg-success-subtle',
      warning: 'bg-warning-subtle',
      danger: 'bg-danger-subtle',
    },
  },
});

const initialsTone = {
  neutral: 'text-fg-muted',
  accent: 'text-accent-fg',
  info: 'text-info-fg',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
} as const;

const iconTone = {
  neutral: 'muted',
  accent: 'accent',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
} as const satisfies Record<AvatarTone | 'neutral', NonNullable<IconProps['tone']>>;

const statusTone = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-fg-subtle',
} as const;

type AvatarTone = 'accent' | 'info' | 'success' | 'warning' | 'danger';
const hashTones: readonly AvatarTone[] = ['accent', 'info', 'success', 'warning', 'danger'];

/** The web's rule: the same name always lands on the same colour, with nothing stored. */
export function avatarToneOf(name: string): AvatarTone {
  let hash = 7;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return hashTones[hash % hashTones.length] ?? 'accent';
}

/** One character, whole: a surrogate pair is one letter, not two halves. */
function firstOf(word: string): string {
  const code = word.codePointAt(0);
  return code === undefined ? '' : String.fromCodePoint(code);
}

/** The first word's initial and the last's, as the web takes them. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = firstOf(parts[0] ?? '');
  const last = parts.length > 1 ? firstOf(parts.at(-1) ?? '') : '';
  return (first + last).toUpperCase();
}

const px = (size: AvatarSize): number => (typeof size === 'number' ? size : SIZES[size]);

export type AvatarProps = {
  /** The person's display name: read to a screen reader and the source of the initials. */
  name: string;
  size?: AvatarSize;
  /** `rounded` for a company or a team: 28% corners rather than a disc. */
  shape?: 'circle' | 'rounded';
  /** `auto` picks a stable tone from the name. */
  tone?: 'auto' | 'neutral' | AvatarTone;
  src?: string;
  /** `contain` for a logo, which must never be cropped. */
  fit?: 'cover' | 'contain';
  /** Overrides the initials: an icon for a team, a building, a bot. */
  icon?: LucideIcon;
  /** A presence dot on the lower edge. Colour only, so pair it with `statusLabel`. */
  status?: keyof typeof statusTone;
  statusLabel?: string;
  /** Hidden from a screen reader, beside the name it would only repeat. */
  decorative?: boolean;
  className?: string | undefined;
};

/**
 * A person's photo or initials. Initials get a stable colour worked out from
 * the name; with no name and no icon, the silhouette.
 */
export function Avatar({
  name,
  size = DEFAULT_SIZE,
  shape = 'circle',
  tone = 'auto',
  src,
  fit = 'cover',
  icon,
  status,
  statusLabel,
  decorative = false,
  className,
}: AvatarProps): React.JSX.Element {
  const side = px(size);
  const initials = initialsOf(name);
  const resolved = tone === 'auto' ? (initials && !icon ? avatarToneOf(name) : 'neutral') : tone;
  const radius = shape === 'circle' ? side / 2 : Math.round(side * 0.28);
  const dot = Math.max(8, Math.round(side * 0.28));
  const said = [name, statusLabel].filter(Boolean).join(', ');

  return (
    <View
      {...(decorative || !said
        ? {
            accessible: false,
            importantForAccessibility: 'no-hide-descendants' as const,
            'aria-hidden': true,
          }
        : {
            accessible: true,
            accessibilityRole: 'image' as const,
            accessibilityLabel: said,
            role: 'img' as const,
          })}
      style={{ width: side, height: side }}
      className={cn(className)}
    >
      <View
        className={avatar({ tone: resolved })}
        style={{ width: side, height: side, borderRadius: radius, overflow: 'hidden' }}
      >
        {src ? (
          <Image
            source={{ uri: src }}
            resizeMode={fit}
            style={{
              width: fit === 'contain' ? side * 0.8 : side,
              height: fit === 'contain' ? side * 0.8 : side,
            }}
          />
        ) : icon || !initials ? (
          <Icon icon={icon ?? User} size={Math.round(side * 0.5)} tone={iconTone[resolved]} />
        ) : (
          <CssText
            className={cn('font-bold', initialsTone[resolved])}
            style={{
              fontSize: Math.round(side * 0.36),
              lineHeight: Math.round(side * 0.36) * 1.15,
            }}
          >
            {initials}
          </CssText>
        )}
      </View>
      {status ? (
        <View
          className={cn('absolute rounded-full border-2 border-surface', statusTone[status])}
          style={{ width: dot + 4, height: dot + 4, right: -3, bottom: -3 }}
        />
      ) : null}
    </View>
  );
}

export type AvatarGroupProps = {
  /** `<Avatar>`s. The group sizes them and rings each against the surface. */
  children: ReactNode;
  /** Show this many, then "+N". */
  max?: number;
  /** The real count, when the children are a page of a longer list. */
  total?: number;
  size?: AvatarSize;
  className?: string | undefined;
};

/**
 * Overlapping avatars and a count. Read as one image, "Priya Shah, Jonas
 * Weber and 2 others", rather than as five.
 */
export function AvatarGroup({
  children,
  max = 4,
  total,
  size = 36,
  className,
}: AvatarGroupProps): React.JSX.Element {
  const side = px(size);
  const avatars = Children.toArray(children).filter((c): c is ReactElement<AvatarProps> =>
    isValidElement(c),
  );
  const shown = avatars.slice(0, max);
  const count = total ?? avatars.length;
  const rest = count - shown.length;
  const overlap = Math.round(side * 0.28);
  const names = shown.map((a) => a.props.name);
  const said =
    rest > 0
      ? `${names.join(', ')} and ${String(rest)} ${rest === 1 ? 'other' : 'others'}`
      : names.join(', ');

  // Each avatar sits in a 2pt surface-coloured ring, so the overlap reads as
  // a stack of discs rather than one shape with bites out of it.
  const ring = (key: string, index: number, inner: ReactNode): ReactNode => (
    <View
      key={key}
      className="rounded-full bg-surface p-0.5"
      style={{ marginLeft: index === 0 ? 0 : -(overlap + 4) }}
    >
      {inner}
    </View>
  );

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={said}
      role="img"
      aria-label={said}
      className={cn('flex-row items-center self-start', className)}
    >
      {shown.map((a, i) =>
        ring(String(a.key ?? i), i, cloneElement(a, { size: side, decorative: true })),
      )}
      {rest > 0
        ? ring(
            'rest',
            shown.length,
            <View
              className="items-center justify-center rounded-full bg-surface-active"
              style={{ width: side, height: side }}
            >
              <CssText
                className="font-semibold text-fg"
                style={{ fontSize: Math.round(side * 0.34) }}
              >
                +{rest}
              </CssText>
            </View>,
          )
        : null}
    </View>
  );
}
