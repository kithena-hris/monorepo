// className on React Native's components, for any program that compiles this
// package's source (the mobile Storybook's included), not only its own.
/// <reference types="react-native-css/types" />

export { cn } from './lib/cn.ts';
export {
  ReachProvider,
  usePlatform,
  useReducedMotion,
  useTheme,
  type Platform,
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
  Checkbox,
  CheckboxBox,
  type CheckboxProps,
  type CheckedState,
} from './components/checkbox/checkbox.tsx';
export {
  addDays,
  addMonths,
  Calendar,
  CalendarLegend,
  daysBetween,
  formatDate,
  parseDate,
  type CalendarMarker,
  type CalendarProps,
  type CalendarTone,
  type DateRange,
  type IsoDate,
} from './components/calendar/calendar.tsx';
export {
  Combobox,
  type ComboboxOption,
  type ComboboxProps,
} from './components/combobox/combobox.tsx';
export {
  DatePicker,
  type DatePickerPreset,
  type DatePickerProps,
} from './components/date-picker/date-picker.tsx';
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
export {
  checkFile,
  displayName,
  Dropzone,
  formatBytes,
  middleTruncate,
  type DropzoneProps,
  type Pick,
  type PickedFile,
  type Refusal,
  type Rejection,
} from './components/dropzone/dropzone.tsx';
export {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  useField,
  type FieldProps,
} from './components/field/field.tsx';
export { Icon, iconVariants, type IconProps, type LucideIcon } from './components/icon/icon.tsx';
export {
  AvatarUploader,
  ImageUploader,
  type AvatarUploaderProps,
  type ImageUploaderProps,
  type UploadedImage,
} from './components/image-uploader/image-uploader.tsx';
export {
  FieldBox,
  Input,
  Textarea,
  type FieldBoxProps,
  type InputProps,
  type InputType,
  type TextareaProps,
} from './components/input/input.tsx';
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
export { NumberField, type NumberFieldProps } from './components/number-field/number-field.tsx';
export { formatNumber, parseNumber } from './components/number-field/number-format.ts';
export {
  defaultPasswordRequirements,
  PasswordField,
  type PasswordFieldProps,
  type PasswordRequirement,
} from './components/password-field/password-field.tsx';
export { PinInput, type PinInputProps } from './components/pin-input/pin-input.tsx';
export { Rating, ratingSymbols, type RatingProps } from './components/rating/rating.tsx';
export {
  RadioCard,
  RadioDot,
  RadioGroup,
  RadioGroupItem,
  type RadioCardProps,
  type RadioGroupItemProps,
  type RadioGroupProps,
} from './components/radio-group/radio-group.tsx';
export { ScrollArea, type ScrollAreaProps } from './components/scroll-area/scroll-area.tsx';
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  type SelectContentProps,
  type SelectItemProps,
  type SelectProps,
  type SelectTriggerProps,
} from './components/select/select.tsx';
export { Separator, type SeparatorProps } from './components/separator/separator.tsx';
export { Slider, type SliderProps } from './components/slider/slider.tsx';
export { Spinner, type SpinnerProps } from './components/spinner/spinner.tsx';
export { Switch, SwitchTrack, type SwitchProps } from './components/switch/switch.tsx';
export { Text, textVariants, type TextProps } from './components/text/text.tsx';
export {
  ChoiceButton,
  commonDialCodes,
  CurrencyField,
  formatMinor,
  parseMinor,
  PhoneField,
  SearchField,
  type CurrencyFieldProps,
  type DialCode,
  type PhoneFieldProps,
  type SearchFieldProps,
} from './components/typed-fields/typed-fields.tsx';
export {
  formatDuration,
  formatTime,
  parseTime,
  TimePicker,
  TimeWheel,
  type TimePickerProps,
} from './components/time-picker/time-picker.tsx';
export {
  segmentItem,
  segmentText,
  segmentTrack,
  segmentTrackFull,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  type ToggleGroupItemProps,
  type ToggleGroupProps,
  type ToggleProps,
} from './components/toggle/toggle.tsx';
export {
  ReachLogo,
  ReachMark,
  type ReachLogoProps,
  type ReachMarkProps,
} from './brand/reach-logo.tsx';
