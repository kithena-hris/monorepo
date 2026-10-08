import {
  Baby,
  CircleSlash,
  Coffee,
  Flag,
  Plane,
  Sun,
  Thermometer,
  Timer,
  TreePalm,
  type LucideIcon,
} from 'lucide-react-native';

/** Time Off's icon names for leave types. */
const LEAVE_ICONS: Readonly<Record<string, LucideIcon>> = {
  sun: Sun,
  coffee: Coffee,
  thermometer: Thermometer,
  baby: Baby,
  timer: Timer,
  'circle-slash': CircleSlash,
  plane: Plane,
  flag: Flag,
};

/** A leave type's icon, from Time Off's name for it. */
export const leaveIcon = (name: string | undefined): LucideIcon =>
  LEAVE_ICONS[name ?? ''] ?? TreePalm;
