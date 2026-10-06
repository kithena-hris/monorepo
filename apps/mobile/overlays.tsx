import { Calendar, House, Info, Pencil, Search, Trash2, User, Users } from 'lucide-react-native';
import { useState } from 'react';

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
} from '@reach/ui-native';

/**
 * The overlays, each behind its trigger: on a device they portal into the
 * provider's host, slide and drag natively, and answer the back button.
 */
export function OverlayGallery(): React.JSX.Element {
  const [section, setSection] = useState('people');
  const [searching, setSearching] = useState(false);
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
            <DialogHeader>
              <DialogTitle>Edit working hours</DialogTitle>
              <DialogDescription>Changes apply from next week.</DialogDescription>
            </DialogHeader>
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
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
              <AlertDialogDescription>Your dates and note will be lost.</AlertDialogDescription>
            </AlertDialogHeader>
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
              </SheetHeader>
              <Text tone="muted">Drag it toward its edge to close.</Text>
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
            <DropdownMenuItem icon={Pencil}>Edit request</DropdownMenuItem>
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
