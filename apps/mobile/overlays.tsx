import {
  Calendar,
  Copy,
  Folder,
  FolderInput,
  House,
  Info,
  MessageCircle,
  Pencil,
  Pin,
  Search,
  Trash2,
  User,
  Users,
  Wallet,
} from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import {
  ActionSheet,
  ActionSheetContent,
  ActionSheetItem,
  ActionSheetTrigger,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  AppBar,
  CommandPalette,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  TabBar,
  Tooltip,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Inline,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Stack,
  Text,
  AlertDialogBody,
  AlertDialogIcon,
  Avatar,
  ContextMenuCheckboxItem,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  DialogBody,
  DialogIcon,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  HoverCard,
  HoverCardAction,
  HoverCardContent,
  HoverCardTrigger,
  LargeTitle,
  NavigationRail,
  PopoverAnchor,
  PopoverClose,
  SelectionBar,
  SheetBody,
  SheetClose,
  SheetDescription,
  SheetFooter,
} from '@reach/ui-native';

/**
 * The overlays, each behind its trigger: on a device they portal into the
 * provider's host, slide and drag natively, and answer the back button.
 */
export function OverlayGallery(): React.JSX.Element {
  const [section, setSection] = useState('people');
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState('name');
  const [shown, setShown] = useState(true);
  const [pinned, setPinned] = useState(true);
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(3);
  const [anchored, setAnchored] = useState(false);
  return (
    <Stack gap={2}>
      <AppBar title="Priya Shah" back={{ label: 'People', onPress: () => undefined }} scrolled />
      <Text variant="headline">Overlays</Text>
      <Inline gap={2}>
        <Dialog>
          <DialogTrigger asChild>
            <Button>Dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogIcon icon={Calendar} />
            <DialogHeader>
              <DialogTitle>Edit working hours</DialogTitle>
              <DialogDescription>Changes apply from next week.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Text tone="muted">Mon–Fri, 9:00–17:30 CET</Text>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="primary">Save</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="danger-soft">Alert</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogIcon icon={Trash2} tone="danger" />
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
              <AlertDialogDescription>Your dates and note will be lost.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogBody>
              <Text tone="muted">Vacation · 14–18 Oct</Text>
            </AlertDialogBody>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button>Cancel</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button variant="danger">Delete</Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {(['bottom', 'top'] as const).map((side) => (
          <Sheet key={side}>
            <SheetTrigger asChild>
              <Button>{side === 'bottom' ? 'Sheet' : 'Top sheet'}</Button>
            </SheetTrigger>
            <SheetContent side={side}>
              <SheetHeader>
                <SheetTitle>Priya Shah</SheetTitle>
                <SheetDescription>Senior Engineer</SheetDescription>
              </SheetHeader>
              <SheetBody>
                <Text tone="muted">Drag it toward its edge to close.</Text>
              </SheetBody>
              <SheetFooter>
                <SheetClose asChild>
                  <Button>Done</Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        ))}

        <ActionSheet>
          <ActionSheetTrigger asChild>
            <Button>Action sheet</Button>
          </ActionSheetTrigger>
          <ActionSheetContent title="Vacation · 14–18 Oct" description="Deleting can’t be undone.">
            <ActionSheetItem>Archive</ActionSheetItem>
            <ActionSheetItem destructive>Delete request</ActionSheetItem>
          </ActionSheetContent>
        </ActionSheet>
        <Popover>
          <PopoverTrigger>
            <Button>Popover</Button>
          </PopoverTrigger>
          <PopoverContent label="Working hours" className="w-[260px]">
            <Text>Mon–Fri, 9:00–17:30 CET</Text>
            <PopoverClose asChild>
              <Button size="sm">Close</Button>
            </PopoverClose>
          </PopoverContent>
        </Popover>

        <Tooltip content="Search">
          <Button
            startIcon={<Icon icon={Search} />}
            accessibilityLabel="Search"
            onPress={() => {
              setSearching(true);
            }}
          />
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button>Menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent label="Request actions">
            <DropdownMenuGroup>
              <DropdownMenuItem icon={Pencil}>Edit request</DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon={FolderInput}>Move to</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem icon={Folder}>Policies</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
              <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="start">Start date</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuCheckboxItem checked={shown} keepOpen onCheckedChange={setShown}>
              Show archived
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={Trash2} destructive>
              Delete request
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Inline>

      <ContextMenu>
        <ContextMenuTrigger>
          <Button startIcon={<Icon icon={Info} />}>Long-press me</Button>
        </ContextMenuTrigger>
        <ContextMenuContent label="Actions">
          <ContextMenuItem icon={Pencil}>Rename</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <ContextMenu>
        <ContextMenuTrigger>
          <Button startIcon={<Icon icon={Folder} />}>Long-press the policy</Button>
        </ContextMenuTrigger>
        <ContextMenuContent label="Leave policy 2025.pdf">
          <ContextMenuGroup>
            <ContextMenuSub>
              <ContextMenuSubTrigger icon={FolderInput}>Move to</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem icon={Folder}>Policies</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuCheckboxItem icon={Pin} checked={pinned} onCheckedChange={setPinned}>
              Pin
            </ContextMenuCheckboxItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuLabel>View</ContextMenuLabel>
          <ContextMenuRadioGroup value={view} onValueChange={setView}>
            <ContextMenuRadioItem value="list">List</ContextMenuRadioItem>
            <ContextMenuRadioItem value="grid">Grid</ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuContent>
      </ContextMenu>

      <Button
        size="sm"
        onPress={() => {
          setAnchored(!anchored);
        }}
      >
        Anchored popover
      </Button>
      <Popover open={anchored} onOpenChange={setAnchored}>
        <PopoverAnchor>
          <Text tone="muted">The popover points here, at a line that is not its trigger.</Text>
        </PopoverAnchor>
        <PopoverContent label="Anchored" className="w-[240px]">
          <Text>Anchored to the line above.</Text>
        </PopoverContent>
      </Popover>

      <HoverCard>
        <HoverCardTrigger>
          <Text tone="accent" weight="semibold">
            Jonas Weber
          </Text>
        </HoverCardTrigger>
        <HoverCardContent
          label="Jonas Weber"
          actions={
            <>
              <HoverCardAction icon={MessageCircle}>Message</HoverCardAction>
              <HoverCardAction icon={Copy}>Copy email</HoverCardAction>
            </>
          }
        >
          <Inline gap={3} wrap={false}>
            <Avatar name="Jonas Weber" size="lg" decorative />
            <Stack gap={0}>
              <Text weight="semibold">Jonas Weber</Text>
              <Text variant="subhead" tone="muted">
                Engineering Manager
              </Text>
            </Stack>
          </Inline>
        </HoverCardContent>
      </HoverCard>

      <LargeTitle>People</LargeTitle>
      <SelectionBar
        label={`${String(selected)} selected`}
        onCancel={() => {
          setSelected(0);
        }}
        onSelectAll={() => {
          setSelected(12);
        }}
      />
      <View style={{ height: 240, flexDirection: 'row' }}>
        <NavigationRail
          items={[
            { key: 'home', label: 'Home', icon: House },
            { key: 'people', label: 'People', icon: Users },
            { key: 'pay', label: 'Pay', icon: Wallet },
          ]}
          value={section}
          onValueChange={setSection}
        />
      </View>

      <TabBar
        items={[
          { key: 'home', label: 'Home', icon: House },
          { key: 'people', label: 'People', icon: Users },
          { key: 'time-off', label: 'Time off', icon: Calendar, badge: 3 },
          { key: 'me', label: 'Me', icon: User },
        ]}
        value={section}
        onValueChange={setSection}
      />

      <CommandPalette
        open={searching}
        onOpenChange={setSearching}
        items={[
          { id: 'time-off', label: 'Request time off', icon: Calendar, group: 'Actions' },
          { id: 'people', label: 'People', icon: Users, group: 'Go to' },
        ]}
      />
    </Stack>
  );
}
