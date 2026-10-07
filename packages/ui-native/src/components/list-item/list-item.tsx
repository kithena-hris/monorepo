import { springs } from '@reach/ui/motion';
import { ChevronRight } from 'lucide-react-native';
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Platform, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { usePress } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { physics } from '../../lib/motion.ts';
import { useReducedMotion } from '../../provider.tsx';
import { Icon, type LucideIcon } from '../icon/icon.tsx';
import { swipeOutcome } from './swipe.ts';

/**
 * The row most lists are built from, and the rounded group that holds them,
 * as the web's: a title and up to two lines under it in the middle, something
 * before (an avatar, an icon, a checkbox) and after (a value, a switch, a
 * button, a chevron). A row is read one at a time; columns that line up are a
 * Table.
 */

export type ListProps = {
  children: ReactNode;
  className?: string | undefined;
};

/** The rounded group, a hairline between its rows. */
export function List({ children, className }: ListProps): React.JSX.Element {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View
      role="list"
      className={cn('overflow-hidden rounded-m-card bg-surface shadow-sm', className)}
    >
      {rows.map((row, i) => (
        <Fragment key={row.key ?? i}>
          {i > 0 ? <View aria-hidden className="h-px bg-border" /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

export type SwipeAction = {
  label: string;
  icon?: LucideIcon;
  /** `danger` is a solid red fill: for delete and nothing gentler. */
  tone?: 'neutral' | 'accent' | 'danger';
  /** The accessible name, when the label alone repeats on every row. */
  name?: string;
  onSelect: () => void;
};

/** The series tones a place's tile can take, as `bg-chart-N`. */
export type IconTone = 1 | 2 | 3 | 4 | 5 | 6;

const TILE: Record<IconTone, string> = {
  1: 'bg-chart-1',
  2: 'bg-chart-2',
  3: 'bg-chart-3',
  4: 'bg-chart-4',
  5: 'bg-chart-5',
  6: 'bg-chart-6',
};

export type ListItemProps = {
  /** The title. */
  children: ReactNode;
  /** An `Avatar`, an `Icon`, or a `Checkbox`. */
  leading?: ReactNode;
  /** A place rather than a person: the glyph in a 30pt tile, in place of `leading`. */
  icon?: LucideIcon;
  /** Fills `icon`'s tile with a series colour and draws the glyph white. */
  iconTone?: IconTone;
  /** One line under the title, truncated. */
  description?: ReactNode;
  /** A longer passage under the description, clamped to two lines. */
  supporting?: ReactNode;
  /** Small text at the end of the title line: a timestamp. */
  meta?: string;
  /** A value, a `Badge`, a `Switch` or a `Button`, after the text. */
  trailing?: ReactNode;
  /** A disclosure chevron: this row opens something. */
  chevron?: boolean;
  /** Tints the row. */
  selected?: boolean;
  /** Dims the row, and a screen reader hears it unavailable. */
  disabled?: boolean;
  /**
   * The whole row becomes one target. Such a row must not also hold a switch
   * or a button: two targets in one is how a tap meant for the row flips a
   * setting.
   */
  onPress?: () => void;
  accessibilityLabel?: string;
  /**
   * Buttons behind the trailing edge, revealed by pulling the row. A full
   * swipe runs the first, so make it the likeliest and least destructive.
   * Three at most. VoiceOver and TalkBack offer them as the row's actions.
   */
  swipeActions?: readonly SwipeAction[];
  /** Lets a pull past most of the row run the first action. On by default. */
  fullSwipe?: boolean;
  /** Starts with the actions showing: a first-run hint that the row can be pulled. */
  defaultSwipeOpen?: boolean;
  /**
   * Off when the container names its own rows, as a `VirtualList` does (it
   * carries each row's position in the whole list): the row then draws
   * without its own list-item role.
   */
  listitem?: boolean;
  className?: string | undefined;
};

const WEB = Platform.OS === 'web';
/** Each action behind a row is 76 wide. */
const ACTION = 76;
/** The snap spring, as a worklet can take it. */
const { mass, stiffness, damping } = physics(springs.snap);
const SNAP = { mass, stiffness, damping };

const actionTone = {
  neutral: ['bg-surface-active', 'text-fg', 'default'],
  accent: ['bg-accent-solid', 'text-fg-on-accent', 'on-accent'],
  danger: ['bg-danger-solid', 'text-fg-on-solid', 'on-accent'],
} as const;

function Body({
  children,
  leading,
  icon,
  iconTone,
  description,
  supporting,
  meta,
  trailing,
  chevron,
}: Omit<ListItemProps, 'onPress' | 'swipeActions' | 'className'>): React.JSX.Element {
  // A navigation row with nothing around its title reads lighter, as a phone's settings list does.
  const plain = !leading && !icon && !description;
  return (
    <>
      {icon ? (
        <View
          aria-hidden
          className={cn(
            'size-[30px] items-center justify-center rounded-[8px]',
            iconTone ? TILE[iconTone] : 'bg-surface-sunken',
          )}
        >
          <Icon icon={icon} size={16} {...(iconTone ? { className: 'text-fg-on-solid' } : {})} />
        </View>
      ) : leading ? (
        <View>{leading}</View>
      ) : null}
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-start justify-between gap-2">
          <CssText
            numberOfLines={1}
            className={cn(
              'flex-1 text-callout leading-[1.3] text-fg',
              plain ? 'font-medium' : 'font-semibold',
            )}
          >
            {children}
          </CssText>
          {meta ? (
            <CssText className="text-[12px] font-normal leading-none text-fg-subtle">
              {meta}
            </CssText>
          ) : null}
        </View>
        {description ? (
          <CssText
            numberOfLines={1}
            // Under a message's title the sender is a byline, a size down.
            className={cn(
              'leading-[1.3] text-fg-muted',
              supporting ? 'text-[13px]' : 'text-[14px]',
            )}
          >
            {description}
          </CssText>
        ) : null}
        {supporting ? (
          <CssText numberOfLines={2} className="mt-1 text-subhead leading-[1.45] text-fg-muted">
            {supporting}
          </CssText>
        ) : null}
      </View>
      {trailing ? <View className="flex-row items-center gap-1">{trailing}</View> : null}
      {chevron ? <Icon icon={ChevronRight} size={16} tone="subtle" /> : null}
    </>
  );
}

export function ListItem({
  onPress,
  swipeActions,
  fullSwipe = true,
  defaultSwipeOpen = false,
  listitem = true,
  selected = false,
  disabled = false,
  accessibilityLabel,
  className,
  ...content
}: ListItemProps): React.JSX.Element {
  // The press is the web row's `active:` fill, without the scale: a full-width
  // row that shrinks would pull away from its neighbours.
  const { pressed, onPressIn, onPressOut } = usePress();
  const plain = !content.leading && !content.icon && !content.description;
  const row = cn(
    'w-full flex-row items-center gap-3 bg-surface px-4 py-2',
    plain ? 'min-h-[52px]' : 'min-h-16',
    content.supporting && 'items-start py-3.5',
    selected && 'bg-accent-subtle',
    pressed && !selected && 'bg-surface-active',
    disabled && 'opacity-50',
    className,
  );
  // Unset, a screen reader reads the row's text in order: the title, then the lines under it.
  const said = accessibilityLabel;

  const body = onPress ? (
    <Pressable
      accessibilityRole="button"
      {...(said ? { accessibilityLabel: said } : {})}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      className={row}
    >
      <Body {...content} />
    </Pressable>
  ) : null;

  if (swipeActions && swipeActions.length > 0) {
    return (
      <Swipeable
        actions={swipeActions}
        full={fullSwipe}
        initiallyOpen={defaultSwipeOpen}
        label={said}
      >
        {body ?? (
          <View className={row}>
            <Body {...content} />
          </View>
        )}
      </Swipeable>
    );
  }
  const item = listitem ? { role: 'listitem' as const } : {};
  if (body) return <View {...item}>{body}</View>;
  return (
    <View {...item} {...(disabled ? { 'aria-disabled': true } : {})} className={row}>
      <Body {...content} />
    </View>
  );
}

function Swipeable({
  actions,
  full,
  initiallyOpen,
  label,
  children,
}: {
  actions: readonly SwipeAction[];
  full: boolean;
  initiallyOpen: boolean;
  label: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const reduced = useReducedMotion();
  const tray = actions.length * ACTION;
  const width = useSharedValue(0);
  const offset = useSharedValue(initiallyOpen ? tray : 0);
  const from = useSharedValue(0);

  const run = (index: number): void => {
    actions[index]?.onSelect();
  };
  const settle = (to: number): void => {
    'worklet';
    offset.value = reduced ? to : withSpring(to, SNAP);
  };
  const close = (): void => {
    settle(0);
  };
  const open = (): void => {
    settle(tray);
  };

  // Whichever axis moves 8pt first owns the gesture: a vertical scroll is never stolen.
  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-8, 8])
    .onBegin(() => {
      from.value = offset.value;
    })
    .onUpdate((e) => {
      offset.value = Math.max(0, Math.min(width.value, from.value - e.translationX));
    })
    .onEnd((e) => {
      const rest = swipeOutcome({
        offset: offset.value,
        velocity: -e.velocityX,
        tray,
        width: width.value,
        full,
      });
      if (rest === 'full') {
        settle(0);
        scheduleOnRN(run, 0);
      } else {
        settle(rest === 'open' ? tray : 0);
      }
    });

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: -offset.value }] }));
  const trayStyle = useAnimatedStyle(() => ({ opacity: offset.value > 0 ? 1 : 0 }));

  return (
    <View
      role="listitem"
      className="overflow-hidden"
      onLayout={(e: LayoutChangeEvent) => {
        width.value = e.nativeEvent.layout.width;
      }}
      // On a phone the actions are the row's own: VoiceOver's rotor, TalkBack's actions menu.
      {...(WEB
        ? {}
        : {
            accessibilityActions: actions.map((a) => ({ name: a.label, label: a.name ?? a.label })),
            onAccessibilityAction: (e: AccessibilityActionEvent) => {
              actions.find((a) => a.label === e.nativeEvent.actionName)?.onSelect();
            },
            ...(label ? { accessibilityLabel: label } : {}),
          })}
    >
      {/*
        Transparent at rest, so the list's rounded corner never shows their
        colour through the row; drawn as soon as a finger moves the row, on
        the UI thread, not once the drag has ended.
      */}
      <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, right: 0 }, trayStyle]}>
        <View
          className="flex-1 flex-row"
          {...(WEB
            ? {}
            : {
                importantForAccessibility: 'no-hide-descendants' as const,
                accessibilityElementsHidden: true,
              })}
        >
          {actions.map((action, i) => {
            const [fill, ink, tone] = actionTone[action.tone ?? 'neutral'];
            return (
              <Pressable
                key={action.label}
                accessibilityRole="button"
                accessibilityLabel={action.name ?? action.label}
                onFocus={open}
                onBlur={close}
                onPress={() => {
                  run(i);
                  close();
                }}
                style={{ width: ACTION }}
                className={cn('items-center justify-center gap-1', fill)}
              >
                {action.icon ? <Icon icon={action.icon} size={18} tone={tone} /> : null}
                <CssText className={cn('text-caption font-semibold', ink)}>{action.label}</CssText>
              </Pressable>
            );
          })}
        </View>
      </Animated.View>
      <GestureDetector gesture={pan}>
        {/* The slide on a bare Animated.View (RMB-001), the row inside it. */}
        <Animated.View style={slide}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
