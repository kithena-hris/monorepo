/**
 * The icon set.
 *
 * ### Why there is a registry at all
 *
 * `lucide-react` ships around 1,500 icons and any of them can be imported
 * directly. That is the problem: given the free choice, three modules pick
 * three different glyphs for "delete", a fourth uses the one that means
 * "archive", and the product stops being learnable. An icon is a word, and a
 * design system that lets every screen invent its own vocabulary is a design
 * system in name only.
 *
 * So this file maps **meanings** to glyphs. `icons.delete` is the contract;
 * which lucide component sits behind it is an implementation detail that can
 * change in one commit, everywhere at once.
 *
 * ### The rules
 *
 * - **One meaning, one glyph.** If two entries would render the same icon,
 *   one of them is the wrong word.
 * - **An icon is never the only signal.** Every icon-only control needs an
 *   `aria-label`, and every status needs its word beside the glyph. Roughly
 *   one man in twelve cannot separate the tones this system uses.
 * - **Decorative icons are `aria-hidden`.** An icon beside a label is
 *   decoration: announcing "trash, Delete" is noise. The icon components in
 *   this system set it for you; a bare lucide icon does not.
 * - **Size comes from the type scale**, never from a hard-coded pixel value.
 *   `size-4` beside `text-base`, `size-3.5` beside `text-sm`.
 *
 * Anything genuinely one-off, a brand mark, a country flag, an illustration.
 * Is not an icon and does not belong here.
 */

import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Ban,
  Bell,
  BuildingComplex,
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  CircleCheck,
  CircleQuestionMark,
  CircleX,
  Clock,
  Copy,
  CreditCard,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileText,
  Flag,
  Folder,
  Funnel,
  GripVertical,
  Hash,
  Heart,
  House,
  ImagePlus,
  Inbox,
  Info,
  Link2,
  LoaderCircle,
  Lock,
  LockOpen,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MessageSquare,
  Minus,
  Moon,
  MoonStar,
  MoveRight,
  Paperclip,
  Pause,
  Pencil,
  Phone,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCcwClock,
  Search,
  Send,
  Settings,
  Share2,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  Star,
  Sun,
  Sunrise,
  Sunset,
  Table2,
  Tag,
  ThumbsDown,
  ThumbsUp,
  Trash,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Undo2,
  Upload,
  User,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';

/**
 * Grouped by what the icon is *for*, not by what it depicts. Someone looking
 * for the delete glyph looks under actions, not under "bin".
 */
export const iconGroups = {
  /** Something the user does. Verbs. */
  action: {
    add: Plus,
    edit: Pencil,
    delete: Trash,
    archive: Archive,
    copy: Copy,
    duplicate: Copy,
    download: Download,
    upload: Upload,
    share: Share2,
    send: Send,
    search: Search,
    filter: Funnel,
    sort: ChevronsUpDown,
    settings: Settings,
    adjust: SlidersHorizontal,
    refresh: RefreshCw,
    undo: Undo2,
    reset: RotateCcw,
    more: Ellipsis,
    overflow: Ellipsis,
    drag: GripVertical,
    move: MoveRight,
    close: X,
    confirm: Check,
    attach: Paperclip,
    link: Link2,
    externalLink: ExternalLink,
    addImage: ImagePlus,
    play: Play,
    pause: Pause,
    signOut: LogOut,
  },
  /** How a record stands. Always paired with the word. */
  status: {
    success: CircleCheck,
    warning: TriangleAlert,
    danger: CircleX,
    info: Info,
    help: CircleQuestionMark,
    pending: Clock,
    blocked: Ban,
    loading: LoaderCircle,
    up: TrendingUp,
    down: TrendingDown,
    flagged: Flag,
    starred: Star,
    favourite: Heart,
    approve: ThumbsUp,
    reject: ThumbsDown,
    /** Handled with more care than most: a change to it waits for a second person. */
    sensitive: ShieldAlert,
  },
  /** Getting around. */
  navigation: {
    home: House,
    menu: Menu,
    back: ArrowLeft,
    forward: ArrowRight,
    up: ArrowUp,
    down: ArrowDown,
    expand: ChevronDown,
    collapse: ChevronUp,
    next: ChevronRight,
    previous: ChevronLeft,
    inbox: Inbox,
    notifications: Bell,
    history: RotateCcwClock,
  },
  /** The nouns of an HRIS. This is the group that keeps a product coherent. */
  domain: {
    person: User,
    people: Users,
    hire: UserPlus,
    approve: UserCheck,
    offboard: UserMinus,
    team: Users,
    organisation: BuildingComplex,
    location: MapPin,
    calendar: Calendar,
    leave: CalendarDays,
    payroll: Wallet,
    payment: CreditCard,
    document: FileText,
    file: File,
    folder: Folder,
    table: Table2,
    tag: Tag,
    identifier: Hash,
    email: Mail,
    phone: Phone,
    message: MessageSquare,
    permission: Shield,
    locked: Lock,
    unlocked: LockOpen,
    visible: Eye,
    hidden: EyeOff,
    theme: Sun,
    themeDark: Moon,
    remove: Minus,
  },
  /**
   * Where a clock has got to, for the band of the day it is in.
   *
   * Five, not the two a light-or-dark toggle needs. `theme` and `themeDark`
   * answer "which colour scheme", which is a setting; these answer "what time
   * is it where you work", which is a fact about the world — and a sun that
   * means both is a glyph doing two jobs badly. A reader who sees the same Sun
   * at 08:00 and at 16:00 learns nothing from it moving.
   *
   * `dawn` and `dusk` are the ones that earn their place. They are the hours
   * when "is anybody at their desk" has a different answer at each end of a
   * company, and a binary day/night glyph flattens both into the wrong one.
   */
  timeOfDay: {
    lateNight: MoonStar,
    dawn: Sunrise,
    daytime: Sun,
    dusk: Sunset,
    night: Moon,
  },
} as const satisfies Record<string, Record<string, LucideIcon>>;

export type IconGroup = keyof typeof iconGroups;

/**
 * The flat registry. `icons.delete`, `icons.person`.
 *
 * Later groups win on a name collision, which is why `approve` resolves to the
 * domain glyph rather than the thumbs-up: in this product approving is
 * something you do to a *person's* request.
 */
export const icons = {
  ...iconGroups.action,
  ...iconGroups.status,
  ...iconGroups.navigation,
  ...iconGroups.domain,
  ...iconGroups.timeOfDay,
} as const;

export type IconName = keyof typeof icons;

/**
 * Every name in the set, for a picker or a gallery.
 *
 * `Object.keys` returns `string[]` and always will: TypeScript cannot promise
 * an object has only the keys its type lists, because a wider value can always
 * be passed where a narrower one is expected. Filtering through a type
 * predicate narrows it soundly, since the predicate's body performs the check
 * it claims, where `as IconName[]` only asserted the same thing without ever
 * looking.
 */
export const iconNames: readonly IconName[] = Object.keys(icons).filter(
  (name): name is IconName => name in icons,
);

export type { LucideIcon };
