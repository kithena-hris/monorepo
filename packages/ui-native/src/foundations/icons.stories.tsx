import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import {
  Archive,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  ChartColumn,
  ChartLine,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Folder,
  Globe,
  GraduationCap,
  Heart,
  HeartPulse,
  House,
  Info,
  LayoutGrid,
  Link,
  List,
  Lock,
  LogOut,
  Mail,
  MapPin,
  MessageCircle,
  Minus,
  Moon,
  Network,
  Paperclip,
  Pencil,
  Phone,
  Plane,
  Plus,
  Receipt,
  Save,
  Search,
  Send,
  Settings,
  Share,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react-native';
import { View } from 'react-native-css/components';

import { Button } from '../components/button/button.tsx';
import { Icon, type LucideIcon } from '../components/icon/icon.tsx';
import { AutoGrid, Inline, Stack } from '../components/layout/layout.tsx';
import { Text, type TextProps } from '../components/text/text.tsx';
import { designDocs } from '../docs/design.ts';

const meta = {
  title: 'Foundations/Icons',
  parameters: designDocs('icons'),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The design's library, by lucide's own names, in the design's order. */
const LIBRARY: readonly [string, LucideIcon][] = [
  ['house', House],
  ['users', Users],
  ['user', User],
  ['user-plus', UserPlus],
  ['calendar', Calendar],
  ['clock', Clock],
  ['wallet', Wallet],
  ['receipt', Receipt],
  ['chart-column', ChartColumn],
  ['chart-line', ChartLine],
  ['settings', Settings],
  ['search', Search],
  ['bell', Bell],
  ['mail', Mail],
  ['message-circle', MessageCircle],
  ['phone', Phone],
  ['map-pin', MapPin],
  ['building-2', Building2],
  ['briefcase', Briefcase],
  ['file-text', FileText],
  ['folder', Folder],
  ['paperclip', Paperclip],
  ['upload', Upload],
  ['download', Download],
  ['share', Share],
  ['link', Link],
  ['copy', Copy],
  ['pencil', Pencil],
  ['trash-2', Trash2],
  ['archive', Archive],
  ['plus', Plus],
  ['minus', Minus],
  ['x', X],
  ['check', Check],
  ['chevron-right', ChevronRight],
  ['chevron-down', ChevronDown],
  ['arrow-right', ArrowRight],
  ['arrow-up-right', ArrowUpRight],
  ['filter', Filter],
  ['sliders-horizontal', SlidersHorizontal],
  ['ellipsis', Ellipsis],
  ['lock', Lock],
  ['shield-check', ShieldCheck],
  ['eye', Eye],
  ['eye-off', EyeOff],
  ['star', Star],
  ['heart', Heart],
  ['sun', Sun],
  ['moon', Moon],
  ['globe', Globe],
  ['plane', Plane],
  ['heart-pulse', HeartPulse],
  ['graduation-cap', GraduationCap],
  ['network', Network],
  ['layout-grid', LayoutGrid],
  ['list', List],
  ['circle-alert', CircleAlert],
  ['triangle-alert', TriangleAlert],
  ['info', Info],
  ['circle-check', CircleCheck],
  ['sparkles', Sparkles],
  ['log-out', LogOut],
];

function Cell({
  name,
  icon,
  box,
}: {
  name: string;
  icon: LucideIcon;
  box: string;
}): React.JSX.Element {
  return (
    <Stack gap={2} align="center" className="px-1 py-3">
      <View className={`items-center justify-center ${box}`}>
        <Icon icon={icon} size={22} />
      </View>
      <Text variant="caption" weight="regular" tone="muted" mono numberOfLines={1}>
        {name}
      </Text>
    </Stack>
  );
}

export const TheSet: Story = {
  name: 'The set',
  render: () => (
    <AutoGrid minItemWidth={80} gap={1}>
      {LIBRARY.slice(0, 24).map(([name, icon]) => (
        <Cell key={name} name={name} icon={icon} box="size-m-tap" />
      ))}
    </AutoGrid>
  ),
};

export const TheLibrary: Story = {
  name: 'The whole library',
  render: () => (
    <AutoGrid minItemWidth={72} gap={0}>
      {LIBRARY.map(([name, icon]) => (
        <Cell key={name} name={name} icon={icon} box="size-8" />
      ))}
    </AutoGrid>
  ),
};

const SIZES: readonly [number, NonNullable<TextProps['variant']>, number][] = [
  [16, 'footnote', 13],
  [20, 'subhead', 15],
  [24, 'body', 17],
];

export const Sizes: Story = {
  name: 'Sizing and alignment',
  parameters: {
    docs: {
      description: {
        story:
          'The icon is three or more points larger than the text beside it, centred on the line.',
      },
    },
  },
  render: () => (
    <Stack gap={3} className="gap-3.5">
      {SIZES.map(([size, variant, text]) => (
        <Inline key={size} gap={2} wrap={false}>
          <Icon icon={Calendar} size={size} />
          <Text variant={variant} weight="medium">
            {`Time off · icon ${String(size)} with text ${String(text)}`}
          </Text>
        </Inline>
      ))}
    </Stack>
  ),
};

export const Labelling: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'An icon-only control names itself with `accessibilityLabel`. Beside visible text an icon is decoration and is hidden, so the label is not read twice.',
      },
    },
  },
  render: () => (
    <Stack gap={3} className="gap-3.5">
      <Inline gap={3}>
        <Button startIcon={<Icon icon={Trash2} />} accessibilityLabel="Delete draft" />
        <Text variant="caption" weight="regular" tone="muted" mono>
          accessibilityLabel="Delete draft"
        </Text>
      </Inline>
      <Inline gap={3}>
        <Button startIcon={<Icon icon={Trash2} />}>Delete draft</Button>
        <Text variant="subhead" tone="muted">
          Visible label when space allows
        </Text>
      </Inline>
      <Inline gap={3} wrap={false}>
        <Icon icon={CircleCheck} tone="success" />
        <Text variant="subhead" tone="muted">
          Decorative next to text: hidden
        </Text>
      </Inline>
    </Stack>
  ),
};

const NAMING: readonly [LucideIcon, string, boolean, string][] = [
  [Archive, 'Archive', true, 'Correct'],
  [Trash2, 'Archive', false, 'Wrong. A bin means delete'],
  [Send, 'Submit request', true, 'Correct'],
  [Save, 'Submit request', false, 'Wrong. A floppy disk means save a draft'],
];

export const Naming: Story = {
  name: 'When the name disagrees with the glyph',
  render: () => (
    <AutoGrid minItemWidth={150} gap={3}>
      {NAMING.map(([icon, label, right, verdict]) => (
        <View
          key={verdict + label}
          className={`gap-2.5 rounded-md p-3.5 ${right ? 'bg-success-subtle' : 'bg-danger-subtle'}`}
        >
          <Inline gap={2} wrap={false}>
            <Icon icon={icon} />
            <Text variant="subhead" weight="semibold">
              {label}
            </Text>
          </Inline>
          <Text variant="caption" weight="semibold" tone={right ? 'success' : 'danger'}>
            {verdict}
          </Text>
        </View>
      ))}
    </AutoGrid>
  ),
};
