// className on React Native's components, for any program that compiles this
// package's source (the mobile Storybook's included), not only its own.
/// <reference types="react-native-css/types" />

export { cn } from './lib/cn.ts';
export {
  ReachProvider,
  useReducedMotion,
  useTheme,
  type ReachProviderProps,
  type Theme,
} from './provider.tsx';
export {
  durations,
  easings,
  gentleSpring,
  motionPresets,
  physics,
  PRESS_SCALE,
  springs,
  type Motion,
  type MotionPresets,
  type Pose,
  type Side,
  type Transition,
} from './lib/motion.ts';
export { animateTo, useLayoutTransition, useMotion, usePress, type Press } from './lib/animate.ts';
export { OverlayHost, type OverlayHostProps } from './lib/overlay-host.tsx';
export { usePresence } from './lib/overlay.tsx';

export {
  Avatar,
  AvatarGroup,
  avatarToneOf,
  initialsOf,
  type AvatarGroupProps,
  type AvatarProps,
  type AvatarSize,
} from './components/avatar/avatar.tsx';
export {
  ActionSheet,
  ActionSheetContent,
  ActionSheetItem,
  ActionSheetTrigger,
  type ActionSheetContentProps,
  type ActionSheetItemProps,
} from './components/action-sheet/action-sheet.tsx';
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogIcon,
  AlertDialogTitle,
  AlertDialogTrigger,
  type AlertDialogContentProps,
} from './components/alert-dialog/alert-dialog.tsx';
export { Badge, type BadgeProps } from './components/badge/badge.tsx';
export { Button, type ButtonProps, type ButtonVariants } from './components/button/button.tsx';
export { Card, CardDescription, CardTitle, type CardProps } from './components/card/card.tsx';
export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogIcon,
  DialogTitle,
  DialogTrigger,
  type DialogContentProps,
  type DialogFooterProps,
  type DialogIconProps,
} from './components/dialog/dialog.tsx';
export { Icon, iconVariants, type IconProps, type LucideIcon } from './components/icon/icon.tsx';
export {
  AutoGrid,
  Container,
  Inline,
  Split,
  Stack,
  type AutoGridProps,
  type ContainerProps,
  type Gap,
  type InlineProps,
  type SplitProps,
  type StackProps,
} from './components/layout/layout.tsx';
export { ScrollArea, type ScrollAreaProps } from './components/scroll-area/scroll-area.tsx';
export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  type SheetContentProps,
} from './components/sheet/sheet.tsx';
export { Separator, type SeparatorProps } from './components/separator/separator.tsx';
export { Spinner, type SpinnerProps } from './components/spinner/spinner.tsx';
export { Text, textVariants, type TextProps } from './components/text/text.tsx';
export {
  ReachLogo,
  ReachMark,
  type ReachLogoProps,
  type ReachMarkProps,
} from './brand/reach-logo.tsx';
