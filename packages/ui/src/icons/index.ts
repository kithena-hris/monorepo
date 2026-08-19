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
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Ban,
  Bell,
  Building2,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
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
  Filter,
  Flag,
  Folder,
  GripVertical,
  Hash,
  Heart,
  HelpCircle,
  History,
  Home,
  ImagePlus,
  Inbox,
  Info,
  Link2,
  Loader2,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MessageSquare,
  Minus,
  Moon,
  MoreHorizontal,
  MoveRight,
  Paperclip,
  Pause,
  Pencil,
  Phone,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  Share2,
  Shield,
  SlidersHorizontal,
  Star,
  Sun,
  Table2,
  Tag,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TrendingDown,
  TrendingUp,
  Undo2,
  Unlock,
  Upload,
  User,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
  X,
  XCircle,
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
    delete: Trash2,
    archive: Archive,
    copy: Copy,
    duplicate: Copy,
    download: Download,
    upload: Upload,
    share: Share2,
    send: Send,
    search: Search,
    filter: Filter,
    sort: ChevronsUpDown,
    settings: Settings,
    adjust: SlidersHorizontal,
    refresh: RefreshCw,
    undo: Undo2,
    reset: RotateCcw,
    more: MoreHorizontal,
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
    success: CheckCircle2,
    warning: AlertTriangle,
    danger: XCircle,
    info: Info,
    help: HelpCircle,
    pending: Clock,
    blocked: Ban,
    loading: Loader2,
    up: TrendingUp,
    down: TrendingDown,
    flagged: Flag,
    starred: Star,
    favourite: Heart,
    approve: ThumbsUp,
    reject: ThumbsDown,
  },
  /** Getting around. */
  navigation: {
    home: Home,
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
    history: History,
  },
  /** The nouns of an HRIS. This is the group that keeps a product coherent. */
  domain: {
    person: User,
    people: Users,
    hire: UserPlus,
    approve: UserCheck,
    offboard: UserMinus,
    team: Users,
    organisation: Building2,
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
    unlocked: Unlock,
    visible: Eye,
    hidden: EyeOff,
    theme: Sun,
    themeDark: Moon,
    remove: Minus,
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
