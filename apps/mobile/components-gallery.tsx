import {
  Accordion,
  AccordionContent,
  AssistantComposer,
  AssistantMessage,
  AssistantPanel,
  Alert,
  CircularProgress,
  Progress,
  AccordionItem,
  AccordionTrigger,
  Avatar,
  AvatarGroup,
  Badge,
  Banner,
  Button,
  Card,
  CardDescription,
  CardTitle,
  ChatComposer,
  ChatLog,
  ChatMessage,
  ChatWindow,
  ChipGroup,
  ChipGroupItem,
  CopyField,
  FloatingButton,
  Icon,
  Inline,
  KbdGroup,
  List,
  NotificationItem,
  NotificationList,
  ListItem,
  SegmentedControl,
  SegmentedControlItem,
  Separator,
  Spinner,
  Stack,
  Text,
  Timeline,
  Toast,
  TimelineItem,
  AssistantAction,
  AssistantDetails,
  AssistantFeedback,
  AssistantLauncher,
  AssistantMark,
  AssistantSource,
  AssistantSources,
  AssistantStep,
  AssistantSteps,
  AssistantSuggestion,
  AssistantSuggestions,
  AssistantText,
  AssistantWidget,
  BannerStack,
  Breadcrumb,
  BreadcrumbBack,
  Carousel,
  ChatHeader,
  ChatTyping,
  Chip,
  CoachMark,
  CoachMarkDot,
  CopyButton,
  EmptyState,
  GroupedNav,
  Kbd,
  Nav,
  NavGroup,
  NavItem,
  NotificationCenter,
  NotificationGroup,
  Pagination,
  Skeleton,
  SpeedDial,
  Stepper,
  StepperDots,
  StepperProgress,
  Strong,
  TableOfContents,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '@reach/ui-native';
import {
  Building2,
  Calendar,
  Download,
  Link,
  Lock,
  Palette,
  Plus,
  Receipt,
  SearchX,
  Settings,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { OverlayGallery } from './overlays.tsx';

const PEOPLE = ['Priya Shah', 'Jonas Weber', 'Amara Okafor', 'Lucas Moreau', 'Mei Tanaka'];

/** The Storybook's Components: actions, display, feedback, overlays and navigation. */
export function ComponentsGallery(): React.JSX.Element {
  return (
    <Stack gap={6}>
      <Stack gap={1}>
        <Text variant="large">Time off</Text>
        <Text variant="title3">Title 3, 20 over 25</Text>
        <Text>Body text at 17 over 22.</Text>
        <Text variant="subhead" tone="muted">
          Subhead, muted
        </Text>
      </Stack>

      <Inline gap={2}>
        <Button variant="primary" startIcon={<Icon icon={Plus} />}>
          New request
        </Button>
        <Button startIcon={<Icon icon={Download} />}>Export</Button>
        <Button variant="tinted" size="sm">
          Compact
        </Button>
        <Button variant="danger" loading>
          Deleting
        </Button>
        <Button variant="outline">Outline</Button>
      </Inline>

      <Inline gap={4}>
        <Spinner size="lg" />
        <Avatar name="Priya Shah" status="success" statusLabel="Online" />
        <AvatarGroup max={3}>
          {PEOPLE.map((name) => (
            <Avatar key={name} name={name} />
          ))}
        </AvatarGroup>
      </Inline>

      <Inline gap={2}>
        <Badge tone="success" dot>
          Active
        </Badge>
        <Badge tone="warning" variant="solid">
          3 overdue
        </Badge>
        <Badge icon={Lock}>Salary</Badge>
        <Badge size="lg" tone="accent" onRemove={() => undefined}>
          Engineering
        </Badge>
      </Inline>

      <ChipGroup type="multiple" defaultValue={['Engineering']} accessibilityLabel="Teams">
        {['All', 'Engineering', 'Design', 'Sales'].map((team) => (
          <ChipGroupItem key={team} value={team}>
            {team}
          </ChipGroupItem>
        ))}
      </ChipGroup>

      <SegmentedControl defaultValue="week" fullWidth accessibilityLabel="Period">
        <SegmentedControlItem value="day">Day</SegmentedControlItem>
        <SegmentedControlItem value="week">Week</SegmentedControlItem>
        <SegmentedControlItem value="month">Month</SegmentedControlItem>
      </SegmentedControl>

      <CopyField label="Employee ID" value="RCH-00412" mono />

      <List>
        <ListItem
          leading={<Avatar name="Amara Okafor" decorative />}
          description="Product Designer"
          chevron
          onPress={() => undefined}
        >
          Amara Okafor
        </ListItem>
        <ListItem
          description="Shown only with a keyboard to hand"
          trailing={<KbdGroup keys={['⌘', 'K']} touch="hide" />}
        >
          Search
        </ListItem>
      </List>

      <Banner rounded tone="info" title="Heads up.">
        Your manager changes on 1 Nov.
      </Banner>
      <Toast title="3 people archived" action={{ label: 'Undo', onPress: () => undefined }}>
        They’re hidden from the directory.
      </Toast>

      <Alert tone="warning" title="2 contracts expire soon">
        Renew them before 12 Oct.
      </Alert>

      <Inline gap={4} wrap={false}>
        <Progress
          showValue
          value={64}
          label="Onboarding"
          valueLabel="7 of 11 tasks"
          className="flex-1"
        />
        <CircularProgress value={null} size={40} label="Loading" />
      </Inline>

      <NotificationList>
        <NotificationItem
          avatar={<Avatar name="Amara Okafor" size={36} decorative />}
          title="Amara requested 5 days off"
          description="14–18 Oct · 9.5 days left after"
          time="12m"
          unread
          actions={[
            { label: 'Decline', onPress: () => undefined },
            { label: 'Approve', onPress: () => undefined, variant: 'primary' },
          ]}
          last
        />
      </NotificationList>

      <ChatWindow composer={<ChatComposer onSend={() => undefined} placeholder="Message Jonas" />}>
        <ChatLog accessibilityLabel="Conversation with Jonas Weber">
          <ChatMessage author="Jonas Weber" meta="09:12">
            Can you cover Amara’s reviews next week?
          </ChatMessage>
          <ChatMessage from="self" meta="09:14 · Read">
            Yes, happy to. Which ones?
          </ChatMessage>
        </ChatLog>
      </ChatWindow>

      <View style={{ height: 360 }}>
        <AssistantPanel
          title="Assistant"
          badge="Beta"
          subtitle="Knows your policies and your team"
          className="flex-1"
          composer={
            <AssistantComposer
              value=""
              onValueChange={() => undefined}
              onSubmit={() => undefined}
            />
          }
        >
          <AssistantMessage from="user">Who is out next week?</AssistantMessage>
          <AssistantMessage from="assistant">
            3 people on your team: Amara (Mon–Fri), Omar (Wed) and Yuki (Fri).
          </AssistantMessage>
        </AssistantPanel>
      </View>

      <Accordion type="single" defaultValue="personal">
        <AccordionItem value="personal">
          <AccordionTrigger>Personal details</AccordionTrigger>
          <AccordionContent>Name, pronouns and date of birth.</AccordionContent>
        </AccordionItem>
        <AccordionItem value="bank">
          <AccordionTrigger>Bank details</AccordionTrigger>
          <AccordionContent>Account holder, IBAN and BIC.</AccordionContent>
        </AccordionItem>
      </Accordion>

      <Timeline accessibilityLabel="Approval">
        <TimelineItem title="Submitted by Amara" timestamp="09:12" tone="accent" />
        <TimelineItem
          title="Waiting for Nora Becker"
          timestamp="Now"
          tone="warning"
          status="current"
        />
        <TimelineItem title="Payroll" status="upcoming" />
      </Timeline>

      <Inline gap={3}>
        <FloatingButton label="New request" />
        <FloatingButton variant="surface" accessibilityLabel="New request" />
      </Inline>

      <Card>
        <CardTitle>Approve 5 days off?</CardTitle>
        <CardDescription>Amara Okafor · 14–18 Oct</CardDescription>
        <View className="h-3" />
        <Separator />
        <Inline gap={2} wrap={false} className="mt-3">
          <Button className="flex-1" fullWidth>
            Decline
          </Button>
          <Button variant="primary" className="flex-1" fullWidth>
            Approve
          </Button>
        </Inline>
      </Card>

      <MoreComponents />
      <OverlayGallery />
    </Stack>
  );
}

const noop = (): void => undefined;

/** Navigation, display and feedback beyond the first screenful. */
function MoreComponents(): React.JSX.Element {
  const { toast } = useToast();
  const [tab, setTab] = useState('overview');
  const [page, setPage] = useState(2);
  const [nav, setNav] = useState('People');
  const [setting, setSetting] = useState('general');
  const [contents, setContents] = useState('overview');
  const [chip, setChip] = useState(true);
  const [assistant, setAssistant] = useState(false);
  return (
    <Stack gap={6}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList accessibilityLabel="Priya Shah">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="time-off">Time off</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-3">
          <Text tone="muted">Senior Engineer · Berlin</Text>
        </TabsContent>
        <TabsContent value="time-off" className="pt-3">
          <Text tone="muted">14.5 days left</Text>
        </TabsContent>
        <TabsContent value="documents" className="pt-3">
          <Text tone="muted">3 documents</Text>
        </TabsContent>
      </Tabs>

      <Stack gap={2}>
        <Breadcrumb
          items={[
            { label: 'People', onPress: noop },
            { label: 'Engineering', onPress: noop },
            { label: 'Priya Shah' },
          ]}
        />
        <BreadcrumbBack label="Engineering" onPress={noop} />
      </Stack>

      <Stack gap={3}>
        <Stepper
          orientation="horizontal"
          label="Request time off"
          steps={[
            { label: 'Type', status: 'done' },
            { label: 'Dates', status: 'current' },
            { label: 'Review' },
          ]}
        />
        <StepperProgress step={2} count={3} label="Request time off" />
        <StepperDots count={5} current={2} />
      </Stack>

      <Pagination page={page} pageCount={5} onPageChange={setPage} />

      <Nav label="Main">
        {(
          [
            ['Home', Building2, undefined],
            ['People', Users, undefined],
            ['Time off', Calendar, 3],
          ] as const
        ).map(([label, icon, count]) => (
          <NavItem
            key={label}
            icon={icon}
            count={count}
            current={nav === label}
            onPress={() => {
              setNav(label);
            }}
          >
            {label}
          </NavItem>
        ))}
        <NavGroup label="Workspace">
          <NavItem icon={Settings} onPress={noop}>
            Settings
          </NavItem>
        </NavGroup>
      </Nav>

      <GroupedNav
        label="Settings"
        currentId={setting}
        onSelect={setSetting}
        groups={[
          {
            id: 'organisation',
            label: 'Organisation',
            icon: Building2,
            items: [
              { id: 'general', label: 'General', icon: Settings },
              { id: 'branding', label: 'Branding', icon: Palette },
            ],
          },
        ]}
      />

      <TableOfContents
        items={[
          { id: 'overview', label: 'Overview' },
          { id: 'how', label: 'How to request' },
          { id: 'planned', label: 'Planned leave', level: 2 },
        ]}
        value={contents}
        onValueChange={setContents}
      />

      <Carousel accessibilityLabel="Events" controls="dots">
        {['Team offsite', 'Benefits fair', 'Training week'].map((title) => (
          <Card key={title}>
            <CardTitle>{title}</CardTitle>
            <CardDescription>Lisbon · 12 Nov</CardDescription>
          </Card>
        ))}
      </Carousel>

      <Inline gap={2}>
        <Chip
          selected={chip}
          onPress={() => {
            setChip(!chip);
          }}
        >
          Remote
        </Chip>
        <Chip onRemove={noop}>Engineering</Chip>
        <Kbd touch="show">⌘K</Kbd>
        <CopyButton value="https://reach.example/p/412" variant="secondary" icon={Link}>
          Copy link
        </CopyButton>
        <Button
          onPress={() => {
            toast({ title: 'Request sent to Jonas' });
          }}
        >
          Show a toast
        </Button>
      </Inline>

      <BannerStack>
        <Banner rounded tone="warning" title="2 contracts expire soon." onDismiss={noop}>
          Renew them before 12 Oct.
        </Banner>
        <Banner rounded tone="neutral" title="Scheduled maintenance.">
          Sunday 02:00–04:00 CET.
        </Banner>
      </BannerStack>

      <Card>
        <EmptyState
          icon={SearchX}
          title="Nothing for “dentl”"
          description="Did you mean “dental”?"
          action={<Button size="sm">Clear the search</Button>}
        />
      </Card>

      <Card className="flex-row items-center gap-3">
        <Skeleton className="size-11 rounded-full" />
        <View className="flex-1 gap-2">
          <Skeleton className="h-3 w-[140px]" />
          <Skeleton className="h-2.5 w-[90px]" />
        </View>
      </Card>

      <NotificationCenter onMarkAllRead={noop}>
        <NotificationGroup label="Today">
          <NotificationItem
            avatar={<Avatar name="Jonas Weber" size={36} decorative />}
            title="Jonas approved your request"
            description="14–18 Oct"
            time="1h"
            last
          />
        </NotificationGroup>
      </NotificationCenter>

      <ChatWindow
        header={<ChatHeader name="Jonas Weber" status="Online" online onClose={noop} />}
        composer={<ChatComposer onSend={noop} placeholder="Message Jonas" />}
      >
        <ChatLog accessibilityLabel="Conversation with Jonas Weber">
          <ChatMessage author="Jonas Weber" meta="09:12">
            Are you in on Friday?
          </ChatMessage>
          <ChatTyping author="Jonas Weber" />
        </ChatLog>
      </ChatWindow>

      <Stack gap={3}>
        <Inline gap={3}>
          <AssistantMark size={44} />
          <AssistantLauncher
            onOpen={() => {
              setAssistant(true);
            }}
          />
        </Inline>
        <AssistantSuggestions>
          <AssistantSuggestion icon={Calendar} onPress={noop}>
            How many days off do I have?
          </AssistantSuggestion>
          <AssistantSuggestion icon={Wallet} onPress={noop}>
            Explain my last payslip
          </AssistantSuggestion>
        </AssistantSuggestions>
        <AssistantMessage
          from="assistant"
          actions={<AssistantFeedback onCopy={noop} onRate={noop} onRetry={noop} />}
        >
          <AssistantText>
            You have <Strong>14.5 days</Strong> left for 2026.
          </AssistantText>
          <AssistantSteps>
            <AssistantStep status="done">Checked your balance</AssistantStep>
            <AssistantStep status="running">Drafting the request</AssistantStep>
          </AssistantSteps>
          <AssistantSources>
            <AssistantSource index={1} onPress={noop}>
              Leave policy §3
            </AssistantSource>
          </AssistantSources>
          <AssistantAction
            icon={Calendar}
            title="Vacation · 5 days"
            description="Goes to Jonas Weber for approval"
            details={[['Dates', 'Mon 14 – Fri 18 Oct']]}
            confirmLabel="Send request"
            onConfirm={noop}
            onCancel={noop}
          />
        </AssistantMessage>
        <AssistantDetails pairs={[['What it reads', 'Policies, your profile and your team']]} />
        <AssistantWidget open={assistant} onOpenChange={setAssistant} height={420}>
          <AssistantPanel
            title="Assistant"
            onMinimize={() => {
              setAssistant(false);
            }}
            className="flex-1"
            composer={<AssistantComposer value="" onValueChange={noop} onSubmit={noop} />}
          >
            <AssistantMessage from="user">Who is out next week?</AssistantMessage>
          </AssistantPanel>
        </AssistantWidget>
      </Stack>

      <View className="h-[220px] overflow-hidden rounded-[20px] bg-surface-sunken">
        <CoachMark
          title="Export the org chart"
          description="Download it as a PDF or PNG."
          step={1}
          total={3}
          onNext={noop}
        >
          <Button startIcon={<Icon icon={Download} />} accessibilityLabel="Export" />
        </CoachMark>
        <View className="absolute top-4 right-4">
          <CoachMarkDot />
        </View>
        <SpeedDial
          placement={{ right: 16, bottom: 16 }}
          accessibilityLabel="Create"
          actions={[
            { label: 'Time off', icon: Calendar, onPress: noop },
            { label: 'Expense', icon: Receipt, onPress: noop },
            { label: 'Invite person', icon: UserPlus, onPress: noop },
          ]}
        />
      </View>
    </Stack>
  );
}
