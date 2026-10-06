import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AppBar,
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogTrigger,
  Field,
  FieldLabel,
  Icon,
  Input,
  LargeTitle,
  List,
  ListItem,
  Stack,
  TabBar,
  Text,
  useAppBarScroll,
} from '@reach/ui-native';
import { House, Plus, User, Users, Wallet, X } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

const PEOPLE = [
  ['Priya Shah', 'Senior Engineer'],
  ['Jonas Weber', 'Engineering Manager'],
  ['Amara Okafor', 'Product Designer'],
  ['Lucas Moreau', 'Account Executive'],
  ['Mei Tanaka', 'Data Analyst'],
  ['Diego Alvarez', 'Support Lead'],
] as const;

/** One tab's screen: the bar, the large title that collapses into it, the list, the tab bar. */
function TabScreen(): React.JSX.Element {
  const { scrolled, onScroll } = useAppBarScroll(44);
  const [tab, setTab] = useState('people');
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <View className="h-[520px] overflow-hidden rounded-[28px] border border-border bg-canvas">
      <AppBar
        scrolled={scrolled || opened !== null}
        {...(opened
          ? {
              title: opened,
              back: {
                label: 'People',
                onPress: () => {
                  setOpened(null);
                },
              },
            }
          : scrolled
            ? { title: 'People' }
            : {})}
        trailing={
          <Button
            size="xs"
            variant="secondary"
            startIcon={<Icon icon={Plus} />}
            accessibilityLabel="Add a person"
          />
        }
      />
      {opened ? (
        <View className="gap-3 px-4">
          <Avatar name={opened} size="2xl" decorative />
          <Text variant="title2" weight="bold">
            {opened}
          </Text>
        </View>
      ) : (
        <ScrollView onScroll={onScroll} scrollEventThrottle={16}>
          <LargeTitle>People</LargeTitle>
          <View className="px-4 pb-[90px]">
            <List>
              {PEOPLE.map(([name, role]) => (
                <ListItem
                  key={name}
                  leading={<Avatar name={name} size={36} decorative />}
                  description={role}
                  chevron
                  onPress={() => {
                    setOpened(name);
                  }}
                >
                  {name}
                </ListItem>
              ))}
            </List>
          </View>
        </ScrollView>
      )}
      <View className="absolute inset-x-2.5 bottom-3">
        <TabBar
          items={[
            { key: 'home', label: 'Home', icon: House },
            { key: 'people', label: 'People', icon: Users },
            { key: 'pay', label: 'Pay', icon: Wallet },
            { key: 'me', label: 'Me', icon: User },
          ]}
          value={tab}
          onValueChange={setTab}
        />
      </View>
    </View>
  );
}

/** A modal page: the whole screen, guarded while there is unsaved work. */
function ModalPage(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('Senior Engineer');
  const [asking, setAsking] = useState(false);
  const dirty = title !== 'Senior Engineer';
  const guard = (): boolean => {
    if (dirty) setAsking(true);
    return dirty;
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">Open a modal page</Button>
      </DialogTrigger>
      <DialogContent size="full" label="Edit Priya Shah" guard={guard}>
        <AppBar
          title="Edit Priya Shah"
          leading={
            <Button
              size="xs"
              variant="secondary"
              startIcon={<Icon icon={X} />}
              accessibilityLabel="Close"
              onPress={() => {
                if (!guard()) setOpen(false);
              }}
            />
          }
        />
        <View className="gap-3 px-4 pt-1">
          <Field>
            <FieldLabel>Job title</FieldLabel>
            <Input value={title} onChange={setTitle} />
          </Field>
          <Text variant="footnote" tone="muted">
            Change the title, then close: the page asks before it discards.
          </Text>
        </View>
        <AlertDialog open={asking} onOpenChange={setAsking}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
              <AlertDialogDescription>
                You’ve edited 1 field. If you leave now, that change is lost.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button>Keep editing</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant="danger"
                  onPress={() => {
                    setTitle('Senior Engineer');
                    setOpen(false);
                  }}
                >
                  Discard
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

/** The Storybook's Layouts: the screen shell, the push, and the modal page. */
export function LayoutsGallery(): React.JSX.Element {
  return (
    <Stack gap={4}>
      <TabScreen />
      <ModalPage />
    </Stack>
  );
}
