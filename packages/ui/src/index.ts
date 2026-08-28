/**
 * Reach UI, the shared design system.
 *
 * Published as `@reach/ui` until the rename reaches the services.
 *
 * Presentation only. This package knows nothing about People, Time Off, or any
 * other module: it imports no contract, no domain type, and no data client, so
 * a module that is sold on its own still gets the whole system. Anything that
 * needs to know what a leave request *is* belongs in that module's app layer,
 * composed out of these parts.
 */

export {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './components/accordion/accordion';
export type { AccordionProps, AccordionTriggerProps } from './components/accordion/accordion';

export { Alert, EmptyState, Skeleton } from './components/feedback/feedback';
export type { AlertProps, EmptyStateProps } from './components/feedback/feedback';

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './components/alert-dialog/alert-dialog';

export {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './components/breadcrumb/breadcrumb';
export type { BreadcrumbItemProps, BreadcrumbLinkProps } from './components/breadcrumb/breadcrumb';

export {
  Calendar,
  addDays,
  addMonths,
  formatIsoDate,
  parseIsoDate,
} from './components/calendar/calendar';
export type { CalendarProps, DateRange, IsoDate } from './components/calendar/calendar';

export {
  BarChart,
  ChartDataTable,
  ChartLegend,
  DonutChart,
  Sparkline,
  TrendChart,
} from './components/chart/chart';
export type {
  BarChartProps,
  ChartInteractionProps,
  ChartLegendItem,
  ChartPoint,
  ChartWindow,
  ChartTone,
  DonutChartProps,
  DonutSlice,
  SparklineProps,
  TrendChartProps,
} from './components/chart/chart';

export { RangeChart } from './components/chart/range-chart';
export type { RangeBand, RangeChartProps } from './components/chart/range-chart';

export { ScatterChart } from './components/chart/scatter-chart';
export type { ScatterChartProps, ScatterPoint } from './components/chart/scatter-chart';

export { WaterfallChart } from './components/chart/waterfall-chart';
export type { WaterfallChartProps, WaterfallStep } from './components/chart/waterfall-chart';

export { TimelineChart } from './components/chart/timeline-chart';
export type {
  TimelineChartProps,
  TimelineDragMode,
  TimelineEntry,
  TimelineMove,
  TimelineRow,
  TimelineSeparator,
  TimelineUnit,
} from './components/chart/timeline-chart';

export { Dropzone } from './components/dropzone/dropzone';
export type { DropzoneProps } from './components/dropzone/dropzone';

export { SortableList } from './components/sortable/sortable';
export type { SortableItem, SortableListProps, SortableMove } from './components/sortable/sortable';

export { Stepper } from './components/stepper/stepper';
export type { StepStatus, StepperProps, StepperStep } from './components/stepper/stepper';

export { CopyButton, CopyField, useClipboard } from './components/clipboard/clipboard';
export type {
  ClipboardStatus,
  CopyButtonProps,
  CopyFieldProps,
  UseClipboardOptions,
  UseClipboardResult,
} from './components/clipboard/clipboard';

export { Combobox } from './components/combobox/combobox';
export type { ComboboxOption, ComboboxProps } from './components/combobox/combobox';

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './components/context-menu/context-menu';
export type {
  ContextMenuItemProps,
  ContextMenuTriggerProps,
} from './components/context-menu/context-menu';

export { DatePicker, defaultPresets } from './components/date-picker/date-picker';
export type { DatePickerPreset, DatePickerProps } from './components/date-picker/date-picker';

export { Avatar, AvatarGroup } from './components/avatar/avatar';
export type { AvatarGroupProps, AvatarProps } from './components/avatar/avatar';

export { ReachLogo, ReachMark, ReachWordmark } from './brand/reach-logo';
export type { ReachLogoProps, ReachMarkProps, ReachWordmarkProps } from './brand/reach-logo';
export { KithenaLogo, KithenaMark, KithenaWordmark } from './brand/kithena-logo';
export type {
  KithenaLogoProps,
  KithenaMarkProps,
  KithenaWordmarkProps,
} from './brand/kithena-logo';

export { Badge } from './components/badge/badge';
export type { BadgeProps } from './components/badge/badge';

export { Button } from './components/button/button';
export type { ButtonProps, ButtonVariants } from './components/button/button';

export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/card/card';
export type { CardProps } from './components/card/card';

export { Checkbox } from './components/checkbox/checkbox';
export type { CheckboxProps } from './components/checkbox/checkbox';

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './components/dialog/dialog';

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './components/dropdown-menu/dropdown-menu';
export type { DropdownMenuProps } from './components/dropdown-menu/dropdown-menu';

export {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from './components/field/field';
export type { FieldLabelProps, FieldProps } from './components/field/field';

export { FileUploader, displayName } from './components/file-uploader/file-uploader';
export type {
  FileRejection,
  FileUploaderProps,
  UploadItem,
  UploadStatus,
} from './components/file-uploader/file-uploader';

export { AvatarUploader, ImageUploader } from './components/image-uploader/image-uploader';
export type {
  AvatarUploaderProps,
  ImageUploaderProps,
  ImageUploadRejection,
  UploadedImage,
} from './components/image-uploader/image-uploader';

export { Kanban } from './components/kanban/kanban';
export type {
  KanbanAction,
  KanbanAutoScroll,
  KanbanColumnDef,
  KanbanDragActivator,
  KanbanHandlePosition,
  KanbanMotion,
  KanbanMove,
  KanbanProps,
  KanbanSelection,
} from './components/kanban/kanban';

export { Input, Textarea } from './components/input/input';
export type { InputProps, TextareaProps } from './components/input/input';

export { Kbd } from './components/kbd/kbd';
export type { KbdProps } from './components/kbd/kbd';

export { Nav, NavGroup, NavItem, NavList, TertiaryNav } from './components/nav/nav';
export type {
  NavGroupProps,
  NavItemProps,
  NavListProps,
  NavProps,
  TertiaryNavProps,
} from './components/nav/nav';

export { AutoGrid, Container, Inline, Split, Stack } from './components/layout/layout';
export type {
  AutoGridProps,
  ContainerProps,
  Gap,
  InlineProps,
  SplitProps,
  StackProps,
} from './components/layout/layout';

export { Money, minorUnitsToDecimalString } from './components/money/money';

export { NumberField } from './components/number-field/number-field';
export type { NumberFieldProps } from './components/number-field/number-field';

export { OrgChart } from './components/org-chart/org-chart';
export type {
  OrgChartProps,
  OrgFocusMode,
  OrgMove,
  OrgNode,
  OrgNodeEvents,
  OrgNodeInfo,
  OrgStatusTone,
  OrgViewerRole,
} from './components/org-chart/org-chart';

export {
  PasswordField,
  defaultPasswordRequirements,
} from './components/password-field/password-field';
export type {
  PasswordFieldProps,
  PasswordRequirement,
} from './components/password-field/password-field';

export { PinInput } from './components/pin-input/pin-input';
export type { PinInputProps } from './components/pin-input/pin-input';
export type { MoneyProps } from './components/money/money';

export { ListDetail } from './components/list-detail/list-detail';
export type { ListDetailProps } from './components/list-detail/list-detail';

export {
  ModalPage,
  ModalPageBody,
  ModalPageClose,
  ModalPageContent,
  ModalPageFooter,
  ModalPageHeader,
  ModalPageTrigger,
} from './components/modal-page/modal-page';
export type {
  ModalPageContentProps,
  ModalPageHeaderProps,
} from './components/modal-page/modal-page';

export {
  PageHeader,
  PageLayout,
  PageSection,
  Toolbar,
  useRailCollapsed,
} from './components/page-layout/page-layout';
export type {
  PageHeaderProps,
  PageLayoutProps,
  PageRailCollapse,
  PageSectionProps,
  ToolbarProps,
} from './components/page-layout/page-layout';

export { Pagination, paginationRange } from './components/pagination/pagination';
export type { PaginationProps } from './components/pagination/pagination';

export {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from './components/popover/popover';
export type { PopoverContentProps } from './components/popover/popover';

export { CircularProgress, Progress } from './components/progress/progress';

export { Reveal, staggerStyle } from './components/reveal/reveal';
export type { RevealProps } from './components/reveal/reveal';

export { RichTextContent, RichTextEditor } from './components/rich-text/rich-text';
export type { RichTextEditorProps, RichTextGroup } from './components/rich-text/rich-text';
export type { CircularProgressProps, ProgressProps } from './components/progress/progress';

export { RadioCard, RadioGroup, RadioGroupItem } from './components/radio-group/radio-group';

export { Rating } from './components/rating/rating';
export type { RatingProps } from './components/rating/rating';
export type { RadioGroupItemProps } from './components/radio-group/radio-group';

export { ScrollArea, ScrollBar } from './components/scroll-area/scroll-area';
export { VirtualList, type VirtualListProps } from './components/virtual-list/virtual-list';
export type { ScrollAreaProps } from './components/scroll-area/scroll-area';

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './components/select/select';
export type { SelectTriggerProps } from './components/select/select';

export { Separator } from './components/separator/separator';
export type { SeparatorProps } from './components/separator/separator';

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
} from './components/sheet/sheet';
export type { SheetContentProps } from './components/sheet/sheet';

export { Slider } from './components/slider/slider';
export type { SliderProps } from './components/slider/slider';

export { Stat } from './components/stat/stat';
export type { StatProps } from './components/stat/stat';

export { Spinner } from './components/spinner/spinner';
export type { SpinnerProps } from './components/spinner/spinner';

export { Switch } from './components/switch/switch';
export type { SwitchProps } from './components/switch/switch';

export { Tabs, TabsContent, TabsList, TabsTrigger } from './components/tabs/tabs';

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './components/table/table';
export type {
  SortDirection,
  TableCellProps,
  TableHeadProps,
  TableProps,
  TableRowProps,
} from './components/table/table';

export { DataTable } from './components/table/data-table';
export type {
  DataColumn,
  DataTableProps,
  DataTableReorder,
  DataTableSort,
} from './components/table/data-table';

export {
  CurrencyField,
  PhoneField,
  SearchField,
  commonDialCodes,
} from './components/typed-fields/typed-fields';
export type {
  CurrencyFieldProps,
  DialCode,
  PhoneFieldProps,
  SearchFieldProps,
} from './components/typed-fields/typed-fields';

export { TagsInput, isEmailish } from './components/tags-input/tags-input';
export type { TagsInputProps } from './components/tags-input/tags-input';

export { Timeline, TimelineItem } from './components/timeline/timeline';
export type { TimelineItemProps } from './components/timeline/timeline';

export { ToastProvider, ToastViewport, useToast } from './components/toast/toast';
export type { ToastOptions, ToastTone } from './components/toast/toast';

export { Toggle, ToggleGroup, ToggleGroupItem } from './components/toggle/toggle';
export type { ToggleGroupItemProps, ToggleProps } from './components/toggle/toggle';

export { Tooltip, TooltipProvider } from './components/tooltip/tooltip';
export type { TooltipProps } from './components/tooltip/tooltip';

export { iconGroups, iconNames, icons } from './icons/index';
export type { IconGroup, IconName, LucideIcon } from './icons/index';

export { cn } from './lib/cn';

export {
  breakpointQuery,
  useBreakpoint,
  useCoarsePointer,
  useMediaQuery,
  usePrefersReducedMotion,
} from './lib/use-media-query';
export type { Breakpoint } from './lib/use-media-query';

export { useInView } from './lib/use-in-view';
export type { UseInViewOptions } from './lib/use-in-view';

/*
 * The motion primitives.
 *
 * Exported because a module composing its own screens needs the same physics
 * the system's components use. A module that reaches for a second spring
 * implementation is a module whose panels settle at a different rate than the
 * rest of the product, which is exactly the kind of incoherence a design system
 * exists to prevent.
 */
export {
  isSpringSettled,
  projectMomentum,
  rubberband,
  springEasing,
  springSettleTime,
  springs,
  stepSpring,
} from './lib/spring';
export type { SpringConfig, SpringName, SpringState } from './lib/spring';

export { useDragDismiss } from './lib/use-drag-dismiss';
export type { DragAxis, UseDragDismissOptions, UseDragDismissResult } from './lib/use-drag-dismiss';
