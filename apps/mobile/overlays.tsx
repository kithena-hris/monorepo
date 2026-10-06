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
  return (
    <Stack gap={2}>
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
      </Inline>
    </Stack>
  );
}
