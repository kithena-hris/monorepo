import type { AnalyticsView } from '../application/screens/analytics.js';
import type { SegmentView } from '../application/screens/segments.js';
import type {
  DeliveriesView,
  ExportBuilderView,
  ImportStageView,
  ImportUploadView,
  IntegrationsView,
} from '../application/screens/operations.js';
import type {
  CompletenessView,
  DirectoryView,
  HistoryChange,
  HistoryView,
  IdentifierReviewsView,
  ComparedPerson,
  ComparedRow,
  DuplicatesView,
  OnboardingView,
  PickerView,
  ProfileView,
} from '../application/screens/people.js';
import type {
  FormValue,
  IdentifierFindingView,
  IdentifierReviewEntry,
  RecordField,
  RecordSection,
} from '../application/screens/model.js';
import type { RolesView } from '../application/screens/roles.js';
import type { PublishPreviewView, RegistryView, SetupView } from '../application/screens/schema.js';
import type { ColumnMapping } from '../application/import/mapping.js';
import type { ListedEndpoint } from '../infrastructure/webhooks/list.js';
import type { FullValuesScreen } from '../application/export/full-values.js';
import type { PeopleBuilder, RequestContext, ViaRest } from './builder.js';

/**
 * The tenant app's screens over GraphQL (PEO-113): the path the shell takes,
 * through the router, now that it has identity's token.
 *
 * Each query is a `/v1/views/*` view model and each mutation one of REST's
 * writes, dispatched in-process to the same route (`viaRest`): the same Zod
 * body parses the arguments, the same `Idempotency-Key` mechanism makes a
 * retry safe (PEO-116), and every decision about who may see or do what is
 * still `application/screens/*`'s. What this file adds is the types.
 *
 * **Field-level absence.** A view model already leaves out what the viewer
 * may not read. A record's values are a keyed list of a union (`FormEntry`),
 * never an object with a field per attribute: GraphQL answers every field it
 * is asked for, so a `salary` field would come back null and say the field
 * exists. A withheld attribute is absent from `values` and from its section's
 * `fields`, as it is from the REST view. `EmptyEntry` is a readable field with
 * nothing in it, which the viewer may know.
 */

type Builder = PeopleBuilder;

type Entry = { readonly key: string; readonly value: FormValue };
type Scope = RecordSection['visibility'][number];
type Option = RecordField['options'][number];

/** A record's values as the list the schema can leave a key out of. */
const entries = (values: Readonly<Record<string, FormValue>>): Entry[] =>
  Object.entries(values).map(([key, value]) => ({ key, value }));

function entryType(value: FormValue): string {
  if (value === null) return 'EmptyEntry';
  if (typeof value === 'string') return 'TextEntry';
  if (typeof value === 'boolean') return 'FlagEntry';
  if (Array.isArray(value)) return 'ListEntry';
  return 'amountMinor' in value ? 'MoneyEntry' : 'SealedEntry';
}

const list = <T>(items: readonly T[]): T[] => [...items];

export function defineScreens(builder: Builder, viaRest: ViaRest): void {
  /* ------------------------------------------------------------ records -- */

  const OptionRef = builder.objectRef<Option>('FieldOption').implement({
    fields: (t) => ({ value: t.exposeString('value'), label: t.exposeString('label') }),
  });

  const RecordFieldRef = builder.objectRef<RecordField>('RecordField').implement({
    description: 'A field the viewer may read, as a form draws it.',
    fields: (t) => ({
      key: t.exposeString('key'),
      label: t.exposeString('label'),
      description: t.exposeString('description', { nullable: true }),
      dataType: t.exposeString('dataType'),
      options: t.field({ type: [OptionRef], resolve: (f) => list(f.options) }),
      required: t.exposeBoolean('required'),
      readOnly: t.exposeBoolean('readOnly'),
      currency: t.string({ nullable: true, resolve: (f) => f.currency ?? null }),
      ownedBy: t.string({
        nullable: true,
        description: 'Who changes a read-only field; null when the viewer does.',
        resolve: (f) => f.ownedBy ?? null,
      }),
    }),
  });

  const RecordSectionRef = builder.objectRef<RecordSection>('RecordSection').implement({
      fields: (t) => ({
        key: t.exposeString('key'),
        label: t.exposeString('label'),
        visibility: t.stringList({ resolve: (s) => list<Scope>(s.visibility) }),
        fields: t.field({ type: [RecordFieldRef], resolve: (s) => list(s.fields) }),
      }),
  });
  const OnboardingSectionRef = builder
    .objectRef<OnboardingView['sections'][number]>('OnboardingSection')
    .implement({
      fields: (t) => ({
        key: t.exposeString('key'),
        label: t.exposeString('label'),
        visibility: t.stringList({ resolve: (s) => list<Scope>(s.visibility) }),
        fields: t.field({ type: [RecordFieldRef], resolve: (s) => list(s.fields) }),
        ask: t.exposeString('ask', { description: 'required, optional or voluntary' }),
      }),
    });
  const ProfileSectionRef = builder
    .objectRef<ProfileView['sections'][number]>('ProfileSection')
    .implement({
      fields: (t) => ({
        key: t.exposeString('key'),
        label: t.exposeString('label'),
        visibility: t.stringList({ resolve: (s) => list<Scope>(s.visibility) }),
        fields: t.field({ type: [RecordFieldRef], resolve: (s) => list(s.fields) }),
        readsLogged: t.exposeBoolean('readsLogged'),
      }),
    });

  const entry = (name: string) => builder.objectRef<Entry>(name);
  const text = (value: FormValue) => (typeof value === 'string' ? value : '');
  const TextEntry = entry('TextEntry').implement({
    fields: (t) => ({
      key: t.exposeString('key'),
      text: t.string({ resolve: (e) => text(e.value) }),
    }),
  });
  const FlagEntry = entry('FlagEntry').implement({
    fields: (t) => ({ key: t.exposeString('key'), flag: t.boolean({ resolve: (e) => e.value === true }) }),
  });
  const ListEntry = entry('ListEntry').implement({
    fields: (t) => ({
      key: t.exposeString('key'),
      items: t.stringList({
        resolve: (e) => (Array.isArray(e.value) ? [...(e.value as readonly string[])] : []),
      }),
    }),
  });
  const money = (value: FormValue) =>
    value !== null && typeof value === 'object' && 'amountMinor' in value
      ? value
      : { amountMinor: '', currency: '' };
  const MoneyEntry = entry('MoneyEntry').implement({
    description: 'Minor units as a string: money is never a float.',
    fields: (t) => ({
      key: t.exposeString('key'),
      amountMinor: t.string({ resolve: (e) => money(e.value).amountMinor }),
      currency: t.string({ resolve: (e) => money(e.value).currency }),
    }),
  });
  const SealedEntry = entry('SealedEntry').implement({
    description: 'An encrypted value. Only its last four characters are ever served.',
    fields: (t) => ({
      key: t.exposeString('key'),
      last4: t.string({
        nullable: true,
        resolve: (e) =>
          e.value !== null && typeof e.value === 'object' && 'last4' in e.value
            ? e.value.last4
            : null,
      }),
    }),
  });
  const EmptyEntry = entry('EmptyEntry').implement({
    description: 'A field the viewer may read that holds nothing yet.',
    fields: (t) => ({ key: t.exposeString('key') }),
  });
  const FormEntry = builder.unionType('FormEntry', {
    description:
      'One value of a record, keyed. A value the viewer may not read is absent from the list — never null.',
    types: [TextEntry, FlagEntry, ListEntry, MoneyEntry, SealedEntry, EmptyEntry],
    resolveType: (e) => entryType(e.value),
  });

  /* ------------------------------------------ doubted identifiers (PEO-125) -- */

  type Finding = IdentifierReviewEntry['findings'][number];
  const FindingRef = builder.objectRef<Finding>('IdentifierFinding').implement({
    description: 'What a country check found on a national identifier. Never the value.',
    fields: (t) => ({
      level: t.exposeString('level', { description: 'ok, attention or mismatch' }),
      code: t.exposeString('code'),
      message: t.exposeString('message'),
    }),
  });
  const FindingNoticeRef = builder
    .objectRef<IdentifierFindingView>('IdentifierFindingNotice')
    .implement({
      description: 'A warning on one field of a form: saved all the same, and reviewed by HR.',
      fields: (t) => ({
        key: t.exposeString('key'),
        label: t.exposeString('label'),
        level: t.exposeString('level'),
        code: t.exposeString('code'),
        message: t.exposeString('message'),
        review: t.exposeString('review', { description: 'pending, accepted or none' }),
      }),
    });
  const ReviewEntryRef = builder
    .objectRef<IdentifierReviewEntry>('IdentifierReviewEntry')
    .implement({
      description: 'A person’s own doubted identifier, still with HR or sent back to them.',
      fields: (t) => ({
        key: t.exposeString('key'),
        label: t.exposeString('label'),
        state: t.exposeString('state', { description: 'pending or sent_back' }),
        findings: t.field({ type: [FindingRef], resolve: (r) => list(r.findings) }),
        note: t.exposeString('note', { nullable: true }),
      }),
    });
  const ReviewItemRef = builder
    .objectRef<IdentifierReviewsView['items'][number]>('IdentifierReviewItem')
    .implement({
      fields: (t) => ({
        personId: t.exposeID('personId'),
        name: t.exposeString('name'),
        attributeKey: t.exposeString('attributeKey'),
        label: t.exposeString('label'),
        last4: t.exposeString('last4', { nullable: true }),
        findings: t.field({ type: [FindingRef], resolve: (r) => list(r.findings) }),
        enteredAt: t.exposeString('enteredAt'),
      }),
    });
  const ReviewsRef = builder
    .objectRef<IdentifierReviewsView>('PeopleIdentifierReviews')
    .implement({
      description: 'HR’s queue of doubted national identifiers, oldest first.',
      fields: (t) => ({
        items: t.field({ type: [ReviewItemRef], resolve: (v) => list(v.items) }),
      }),
    });
  /* ------------------------------------------------- duplicates (PEO-074) -- */

  const DuplicateItemRef = builder
    .objectRef<DuplicatesView['items'][number]>('DuplicatePair')
    .implement({
      description: 'Two records that look like one human, and why. Never a value.',
      fields: (t) => ({
        personIds: t.idList({ resolve: (d) => [...d.personIds] }),
        names: t.stringList({ resolve: (d) => [...d.names] }),
        reasons: t.stringList({ resolve: (d) => list(d.reasons) }),
      }),
    });
  const ComparedPersonRef = builder.objectRef<ComparedPerson>('ComparedPerson').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      status: t.exposeString('status'),
      refusal: t.exposeString('refusal', {
        nullable: true,
        description: 'Why this record may not absorb the other; null when it may.',
      }),
    }),
  });
  const ComparedRowRef = builder.objectRef<ComparedRow>('ComparedRow').implement({
    description: 'One attribute side by side, as the viewer may read it. A sealed value is its last four.',
    fields: (t) => ({
      key: t.exposeString('key'),
      label: t.exposeString('label'),
      values: t.field({ type: ['String'], nullable: { items: true, list: false }, resolve: (r) => [...r.values] }),
      same: t.exposeBoolean('same'),
      takeable: t.field({ type: ['Boolean'], resolve: (r) => [...r.takeable] }),
    }),
  });
  const ComparisonRef = builder
    .objectRef<NonNullable<DuplicatesView['comparison']>>('DuplicateComparison')
    .implement({
      fields: (t) => ({
        people: t.field({ type: [ComparedPersonRef], resolve: (c) => [...c.people] }),
        rows: t.field({ type: [ComparedRowRef], resolve: (c) => list(c.rows) }),
      }),
    });
  const DuplicatesRef = builder.objectRef<DuplicatesView>('PeopleDuplicates').implement({
    description: 'HR’s queue of suspected duplicates, strongest first; a merge is always HR’s decision.',
    fields: (t) => ({
      items: t.field({ type: [DuplicateItemRef], resolve: (v) => list(v.items) }),
      comparison: t.field({ type: ComparisonRef, nullable: true, resolve: (v) => v.comparison }),
    }),
  });
  const DismissedRef = builder
    .objectRef<{ personIds: readonly string[]; decision: string }>('DuplicateDismissed')
    .implement({
      fields: (t) => ({
        personIds: t.idList({ resolve: (d) => [...d.personIds] }),
        decision: t.exposeString('decision'),
      }),
    });
  builder.queryField('peopleDuplicates', (t) =>
    t.field({
      type: DuplicatesRef,
      description: 'Suspected duplicates (PEO-074), and the pair a and b side by side; HR only.',
      args: { a: t.arg.id(), b: t.arg.id() },
      resolve: (_root, args, ctx) => {
        const query = new URLSearchParams();
        if (args.a) query.set('a', args.a);
        if (args.b) query.set('b', args.b);
        const qs = query.toString();
        return viaRest<DuplicatesView>(ctx, 'GET', `/v1/views/duplicates${qs === '' ? '' : `?${qs}`}`);
      },
    }),
  );
  builder.mutationField('dismissDuplicate', (t) =>
    t.field({
      type: DismissedRef,
      description: 'HR says a pair are two people; the queue stops offering it.',
      args: {
        personIds: t.arg.idList({ required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: (_root, args, ctx) =>
        viaRest<{ personIds: string[]; decision: string }>(ctx, 'POST', '/v1/duplicates/dismissals', {
          body: { personIds: args.personIds.map(String) },
          key: args.idempotencyKey,
        }),
    }),
  );

  const FindingsRef = builder
    .objectRef<{ findings: readonly IdentifierFindingView[] }>('IdentifierCheck')
    .implement({
      fields: (t) => ({
        findings: t.field({ type: [FindingNoticeRef], resolve: (v) => list(v.findings) }),
      }),
    });

  /* --------------------------------------------------- people's screens -- */

  const Onboarding = builder.objectRef<OnboardingView>('PeopleOnboarding').implement({
    fields: (t) => ({
      firstName: t.exposeString('firstName'),
      sections: t.field({ type: [OnboardingSectionRef], resolve: (v) => list(v.sections) }),
      values: t.field({ type: [FormEntry], resolve: (v) => entries(v.values) }),
      saved: t.stringList({ resolve: (v) => list(v.saved) }),
      reviews: t.field({ type: [ReviewEntryRef], resolve: (v) => list(v.reviews) }),
    }),
  });

  const ProfilePerson = builder.objectRef<ProfileView['person']>('ProfilePerson').implement({
    fields: (t) => ({
      name: t.exposeString('name'),
      summary: t.exposeString('summary', { nullable: true }),
      avatarUrl: t.exposeString('avatarUrl', { nullable: true }),
      missing: t.exposeInt('missing', {
        nullable: true,
        description: 'Null when the viewer may not judge this record’s completeness.',
      }),
    }),
  });
  const PersonCalendar = builder
    .objectRef<NonNullable<ProfileView['calendar']>>('PersonCalendar')
    .implement({
      fields: (t) => ({ today: t.exposeString('today'), timeZone: t.exposeString('timeZone') }),
    });
  type Employment = NonNullable<ProfileView['employment']>;
  const ProfilePeriod = builder
    .objectRef<Employment['periods'][number]>('ProfileEmploymentPeriod')
    .implement({
      fields: (t) => ({
        period: t.exposeInt('period'),
        startedOn: t.exposeString('startedOn'),
        lastWorkingDay: t.string({ nullable: true, resolve: (p) => p.lastWorkingDay }),
        leavingReason: t.string({ nullable: true, resolve: (p) => p.leavingReason }),
        eligibleForRehire: t.boolean({ nullable: true, resolve: (p) => p.eligibleForRehire }),
        noticeFrom: t.string({ nullable: true, resolve: (p) => p.noticeFrom }),
        rehireOverrideReason: t.string({ nullable: true, resolve: (p) => p.rehireOverrideReason }),
      }),
    });
  const ProfileEmployment = builder.objectRef<Employment>('ProfileEmployment').implement({
    fields: (t) => ({
      status: t.exposeString('status'),
      periods: t.field({ type: [ProfilePeriod], resolve: (e) => list(e.periods) }),
    }),
  });
  type Placement = NonNullable<ProfileView['placement']>;
  const PlacementLocation = builder
    .objectRef<Placement['locations'][number]>('PlacementLocation')
    .implement({
      fields: (t) => ({
        value: t.exposeString('value'),
        label: t.exposeString('label'),
        legalEntityId: t.exposeString('legalEntityId'),
      }),
    });
  const PlacementRef = builder.objectRef<Placement>('ProfilePlacement').implement({
    description: 'Where the person sits, and where HR may move them (PEO-123).',
    fields: (t) => ({
      legalEntityId: t.exposeString('legalEntityId', { nullable: true }),
      locationId: t.exposeString('locationId', { nullable: true }),
      entities: t.field({ type: [OptionRef], resolve: (p) => list(p.entities) }),
      locations: t.field({ type: [PlacementLocation], resolve: (p) => list(p.locations) }),
    }),
  });
  const Profile = builder.objectRef<ProfileView>('PeopleProfile').implement({
    fields: (t) => ({
      person: t.field({ type: ProfilePerson, resolve: (v) => v.person }),
      sections: t.field({ type: [ProfileSectionRef], resolve: (v) => list(v.sections) }),
      values: t.field({ type: [FormEntry], resolve: (v) => entries(v.values) }),
      calendar: t.field({
        type: PersonCalendar,
        nullable: true,
        description: 'HR’s alone: their zone and today on it (PRD §6.8).',
        resolve: (v) => v.calendar,
      }),
      employment: t.field({
        type: ProfileEmployment,
        nullable: true,
        description: 'HR’s alone: their status and every employment period (PEO-120).',
        resolve: (v) => v.employment,
      }),
      placement: t.field({
        type: PlacementRef,
        nullable: true,
        description: 'Null unless the viewer is HR and there is somewhere to place the person.',
        resolve: (v) => v.placement ?? null,
      }),
      reviews: t.field({
        type: [ReviewEntryRef],
        description: 'Their doubted identifiers still open, on fields the viewer reads (PEO-125).',
        resolve: (v) => list(v.reviews),
      }),
    }),
  });

  const HistoryChangeRef = builder.objectRef<HistoryChange>('HistoryChange').implement({
    description:
      'One recorded change (PEO-064). A sealed field’s change is a `SealedEntry` with no last four.',
    fields: (t) => ({
      id: t.exposeID('id'),
      key: t.exposeString('key'),
      value: t.field({ type: FormEntry, resolve: (c) => ({ key: c.key, value: c.value }) }),
      effectiveFrom: t.exposeString('effectiveFrom'),
      recordedAt: t.exposeString('recordedAt'),
      by: t.exposeString('by'),
      supersedes: t.exposeID('supersedes', { nullable: true }),
      supersededBy: t.exposeID('supersededBy', { nullable: true }),
    }),
  });
  const HistoryPerson = builder
    .objectRef<HistoryView['person']>('HistoryPerson')
    .implement({ fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }) });
  const HistoryRef = builder.objectRef<HistoryView>('PeopleHistory').implement({
    description:
      'A record as of a date, and every change behind it, as the viewer may read them now.',
    fields: (t) => ({
      person: t.field({ type: HistoryPerson, resolve: (v) => v.person }),
      asOf: t.exposeString('asOf', { nullable: true }),
      sections: t.field({ type: [RecordSectionRef], resolve: (v) => list(v.sections) }),
      dated: t.stringList({ resolve: (v) => list(v.dated) }),
      values: t.field({ type: [FormEntry], resolve: (v) => entries(v.values) }),
      changes: t.field({ type: [HistoryChangeRef], resolve: (v) => list(v.changes) }),
    }),
  });

  type Directory = DirectoryView;
  type Listed = Directory['people'][number];
  const Column = builder.objectRef<Directory['columns'][number]>('DirectoryColumn').implement({
    fields: (t) => ({ key: t.exposeString('key'), label: t.exposeString('label') }),
  });
  const Filterable = builder
    .objectRef<Directory['filterable'][number]>('DirectoryFilter')
    .implement({
      fields: (t) => ({
        key: t.exposeString('key'),
        label: t.exposeString('label'),
        options: t.field({ type: [OptionRef], resolve: (f) => list(f.options) }),
      }),
    });
  const Cell = builder.objectRef<{ key: string; value: string }>('DirectoryCell').implement({
    description: 'A column value; a column the viewer may not read on this person is absent.',
    fields: (t) => ({ key: t.exposeString('key'), value: t.exposeString('value') }),
  });
  const DirectoryPerson = builder.objectRef<Listed>('DirectoryPerson').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      email: t.exposeString('email', { nullable: true }),
      avatarUrl: t.exposeString('avatarUrl', { nullable: true }),
      values: t.field({
        type: [Cell],
        resolve: (p) => Object.entries(p.values).map(([key, value]) => ({ key, value })),
      }),
      missing: t.exposeInt('missing', { nullable: true }),
    }),
  });
  const DirectoryCan = builder.objectRef<Directory['can']>('DirectoryActions').implement({
    fields: (t) => ({
      import: t.exposeBoolean('import'),
      export: t.exposeBoolean('export'),
    }),
  });
  const SegmentRef = builder
    .objectRef<{ readonly id: string; readonly name: string }>('PeopleSegmentRef')
    .implement({
      description: 'A saved segment, by name (PEO-068).',
      fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }),
    });
  const DirectoryRef = builder.objectRef<Directory>('PeopleDirectory').implement({
    fields: (t) => ({
      segment: t.field({ type: SegmentRef, nullable: true, resolve: (v) => v.segment }),
      segments: t.field({
        type: [SegmentRef],
        description: 'The saved segments this viewer could apply here.',
        resolve: (v) => list(v.segments),
      }),
      active: t.exposeInt('active'),
      incomplete: t.exposeInt('incomplete', { nullable: true }),
      columns: t.field({ type: [Column], resolve: (v) => list(v.columns) }),
      filterable: t.field({ type: [Filterable], resolve: (v) => list(v.filterable) }),
      people: t.field({ type: [DirectoryPerson], resolve: (v) => list(v.people) }),
      next: t.exposeString('next', { nullable: true }),
      can: t.field({ type: DirectoryCan, resolve: (v) => v.can }),
    }),
  });

  type Completeness = CompletenessView;
  const Waiting = builder.objectRef<Completeness['waiting']>('CompletenessWaiting').implement({
    fields: (t) => ({
      people: t.exposeInt('people'),
      lastReminded: t.exposeString('lastReminded', { nullable: true }),
    }),
  });
  const GridField = builder
    .objectRef<Completeness['fields'][number]>('CompletenessField')
    .implement({
      fields: (t) => ({
        key: t.exposeString('key'),
        label: t.exposeString('label'),
        options: t.field({ type: [OptionRef], resolve: (f) => list(f.options) }),
        person: t.exposeBoolean('person', {
          description: 'A person reference: picked with peoplePicker, not from options',
        }),
      }),
    });
  const GridRow = builder.objectRef<Completeness['rows'][number]>('CompletenessRow').implement({
    fields: (t) => ({
      personId: t.exposeID('personId'),
      name: t.exposeString('name'),
      department: t.exposeString('department', { nullable: true }),
      manager: t.exposeString('manager', { nullable: true }),
      missing: t.stringList({ resolve: (r) => list(r.missing) }),
    }),
  });
  const CompletenessRef = builder.objectRef<Completeness>('PeopleCompleteness').implement({
    fields: (t) => ({
      since: t.exposeString('since'),
      waiting: t.field({ type: Waiting, resolve: (v) => v.waiting }),
      completedThisWeek: t.exposeInt('completedThisWeek'),
      toFill: t.exposeInt('toFill', { description: 'Over everybody, not only this page' }),
      fields: t.field({ type: [GridField], resolve: (v) => list(v.fields) }),
      rows: t.field({ type: [GridRow], resolve: (v) => list(v.rows) }),
      next: t.exposeString('next', { nullable: true }),
    }),
  });
  const Picker = builder.objectRef<PickerView>('PeoplePicker').implement({
    description: 'People to pick from, a keyset page at a time (PEO-122).',
    fields: (t) => ({
      options: t.field({ type: [OptionRef], resolve: (v) => list(v.options) }),
      next: t.exposeString('next', { nullable: true }),
    }),
  });

  const RolesPerson = builder
    .objectRef<RolesView['people'][number]>('RoleSettingsPerson')
    .implement({
      fields: (t) => ({
        accountId: t.exposeID('accountId'),
        personId: t.exposeID('personId', {
          nullable: true,
          description: 'Null for an account People has no person for yet.',
        }),
        name: t.exposeString('name', { nullable: true }),
        workEmail: t.exposeString('workEmail', { nullable: true }),
        roles: t.stringList({ resolve: (p) => list<string>(p.roles) }),
      }),
    });
  const RoleSettings = builder.objectRef<RolesView>('PeopleRoleSettings').implement({
    fields: (t) => ({
      viewerAccountId: t.exposeID('viewerAccountId'),
      canManage: t.exposeBoolean('canManage'),
      people: t.field({ type: [RolesPerson], resolve: (v) => list(v.people) }),
    }),
  });

  /* ----------------------------------------------- registry and setup -- */

  const Published = builder
    .objectRef<NonNullable<RegistryView['published']>>('RegistryPublished')
    .implement({
      fields: (t) => ({
        version: t.exposeInt('version'),
        publishedAt: t.exposeString('publishedAt'),
      }),
    });
  const RegistrySection = builder
    .objectRef<RegistryView['sections'][number]>('RegistrySection')
    .implement({
      fields: (t) => ({
        key: t.exposeString('key'),
        label: t.exposeString('label'),
        visibility: t.stringList({ resolve: (s) => list(s.visibility) }),
        ownership: t.stringList({ resolve: (s) => list(s.ownership) }),
        origin: t.exposeString('origin'),
        fixed: t.exposeBoolean('fixed'),
      }),
    });
  /*
   * The closed predicate (PEO-065) and custom visibility rules (PEO-066). One
   * clause type rather than a union per operand: `in` for the five that list
   * values, `key`/`is`/`equals` for another field, and REST's Zod — the
   * contract's own schema — refuses any mix the grammar does not allow.
   */
  type Field = RegistryView['fields'][number];
  type Clause = NonNullable<Field['requiredWhen']>['clauses'][number];
  const Clause = builder.objectRef<Clause>('PredicateClause').implement({
    fields: (t) => ({
      operand: t.exposeString('operand'),
      in: t.stringList({
        nullable: true,
        resolve: (c) => ('in' in c ? list<string>(c.in) : null),
      }),
      key: t.string({ nullable: true, resolve: (c) => ('key' in c ? c.key : null) }),
      is: t.string({ nullable: true, resolve: (c) => ('is' in c ? c.is : null) }),
      equals: t.string({ nullable: true, resolve: (c) => ('equals' in c ? c.equals : null) }),
    }),
  });
  const Predicate = builder
    .objectRef<NonNullable<Field['requiredWhen']>>('PersonPredicate')
    .implement({
      fields: (t) => ({
        combine: t.exposeString('combine'),
        clauses: t.field({ type: [Clause], resolve: (p) => list(p.clauses) }),
      }),
    });
  const Rule = builder.objectRef<Field['visibilityRules'][number]>('VisibilityRule').implement({
    fields: (t) => ({
      scopes: t.stringList({ resolve: (r) => list<string>(r.scopes) }),
      when: t.field({ type: Predicate, resolve: (r) => r.when }),
    }),
  });
  const Choice = builder
    .objectRef<RegistryView['choices']['countries'][number]>('RegistryChoice')
    .implement({
      fields: (t) => ({ value: t.exposeString('value'), label: t.exposeString('label') }),
    });
  const Choices = builder.objectRef<RegistryView['choices']>('RegistryChoices').implement({
    fields: (t) => ({
      legalEntities: t.field({ type: [Choice], resolve: (c) => list(c.legalEntities) }),
      countries: t.field({ type: [Choice], resolve: (c) => list(c.countries) }),
    }),
  });
  const RegistryField = builder
    .objectRef<RegistryView['fields'][number]>('RegistryField')
    .implement({
      fields: (t) => ({
        key: t.exposeString('key'),
        sectionKey: t.exposeString('sectionKey'),
        label: t.exposeString('label'),
        description: t.exposeString('description', { nullable: true }),
        dataType: t.exposeString('dataType'),
        options: t.stringList({ resolve: (f) => list(f.options) }),
        requiredness: t.exposeString('requiredness'),
        requiredWhen: t.field({
          type: Predicate,
          nullable: true,
          description: 'When a conditional field is required; null unless it is conditional.',
          resolve: (f) => f.requiredWhen,
        }),
        ownership: t.stringList({ resolve: (f) => list(f.ownership) }),
        visibility: t.stringList({ resolve: (f) => list(f.visibility) }),
        visibilityRules: t.field({
          type: [Rule],
          description: 'Scopes that may also read it, on the records each predicate holds for.',
          resolve: (f) => list(f.visibilityRules),
        }),
        collectAt: t.exposeString('collectAt'),
        classification: t.exposeString('classification'),
        piiKind: t.exposeString('piiKind'),
        origin: t.exposeString('origin'),
        pending: t.exposeString('pending', {
          nullable: true,
          description: 'added, changed or archived since the published version; null for none.',
        }),
      }),
    });
  const Registry = builder.objectRef<RegistryView>('PeopleRegistry').implement({
    fields: (t) => ({
      published: t.field({ type: Published, nullable: true, resolve: (v) => v.published }),
      unpublishedChanges: t.exposeInt('unpublishedChanges'),
      sections: t.field({ type: [RegistrySection], resolve: (v) => list(v.sections) }),
      fields: t.field({ type: [RegistryField], resolve: (v) => list(v.fields) }),
      choices: t.field({ type: Choices, resolve: (v) => v.choices }),
    }),
  });

  type Preview = PublishPreviewView;
  const Change = builder.objectRef<Preview['changes'][number]>('PublishChange').implement({
    fields: (t) => ({
      kind: t.exposeString('kind'),
      key: t.exposeString('key'),
      summary: t.exposeString('summary'),
      specialCategory: t.exposeBoolean('specialCategory'),
    }),
  });
  const Impact = builder.objectRef<Preview['impact']>('PublishImpact').implement({
    fields: (t) => ({
      evaluated: t.exposeInt('evaluated'),
      becomingIncomplete: t.exposeInt('becomingIncomplete'),
      becomingComplete: t.exposeInt('becomingComplete'),
      forEmployees: t.exposeInt('forEmployees'),
      forStaff: t.exposeInt('forStaff'),
    }),
  });
  const PreviewRef = builder.objectRef<Preview>('PublishPreview').implement({
    fields: (t) => ({
      nextVersion: t.exposeInt('nextVersion'),
      unchanged: t.exposeBoolean('unchanged'),
      changes: t.field({ type: [Change], resolve: (v) => list(v.changes) }),
      impact: t.field({ type: Impact, resolve: (v) => v.impact }),
      integrationsNotified: t.exposeInt('integrationsNotified'),
    }),
  });

  type Advice = {
    readonly kind: string;
    readonly classification?: string;
    readonly piiKind: string;
    readonly reason?: string;
    readonly floor?: string;
  };
  const AdviceRef = builder.objectRef<Advice>('ClassificationAdvice').implement({
    description: 'protect (special category), suggest, or fallback to the section default.',
    fields: (t) => ({
      kind: t.exposeString('kind'),
      classification: t.string({ nullable: true, resolve: (a) => a.classification ?? null }),
      piiKind: t.exposeString('piiKind'),
      reason: t.string({ nullable: true, resolve: (a) => a.reason ?? null }),
      floor: t.string({ nullable: true, resolve: (a) => a.floor ?? null }),
    }),
  });

  type Setup = SetupView;
  const Entity = builder
    .objectRef<NonNullable<Setup['legalEntity']>>('SetupLegalEntity')
    .implement({
      fields: (t) => ({ name: t.exposeString('name'), country: t.exposeString('country') }),
    });
  const Country = builder.objectRef<Setup['countries'][number]>('SetupCountry').implement({
    fields: (t) => ({ code: t.exposeString('code'), name: t.exposeString('name') }),
  });
  type Pack = Setup['packs'][number];
  const PackSection = builder.objectRef<Pack['sections'][number]>('SetupPackSection').implement({
    fields: (t) => ({
      key: t.exposeString('key'),
      label: t.exposeString('label'),
      summary: t.exposeString('summary'),
      required: t.exposeInt('required'),
      requiredByLaw: t.exposeInt('requiredByLaw'),
      onByDefault: t.exposeBoolean('onByDefault'),
    }),
  });
  const PackRef = builder.objectRef<Pack>('SetupPack').implement({
    fields: (t) => ({
      country: t.exposeString('country'),
      countryName: t.exposeString('countryName'),
      fields: t.exposeInt('fields'),
      sections: t.field({ type: [PackSection], resolve: (p) => list(p.sections) }),
    }),
  });
  const SetupProfile = builder
    .objectRef<NonNullable<Setup['profile']>>('SetupProfile')
    .implement({
      fields: (t) => ({
        sections: t.field({ type: [RecordSectionRef], resolve: (p) => list(p.sections) }),
        values: t.field({ type: [FormEntry], resolve: (v) => entries(v.values) }),
      }),
    });
  const SetupRef = builder.objectRef<Setup>('PeopleSetup').implement({
    fields: (t) => ({
      legalEntity: t.field({
        type: Entity,
        nullable: true,
        description: 'The company’s first legal entity; null until the back office or an admin made one.',
        resolve: (v) => v.legalEntity ?? null,
      }),
      entityConfirmed: t.exposeBoolean('entityConfirmed'),
      countries: t.field({ type: [Country], resolve: (v) => list(v.countries) }),
      packs: t.field({ type: [PackRef], resolve: (v) => list(v.packs) }),
      published: t.exposeInt('published', { nullable: true }),
      profile: t.field({ type: SetupProfile, nullable: true, resolve: (v) => v.profile }),
    }),
  });

  /* -------------------------------------------------------- integrations -- */

  const IntegrationField = builder
    .objectRef<IntegrationsView['fields'][number]>('IntegrationField')
    .implement({
      fields: (t) => ({
        key: t.exposeString('key'),
        label: t.exposeString('label'),
        refused: t.exposeString('refused', {
          nullable: true,
          description: 'special-category or encrypted: never sent to a webhook.',
        }),
      }),
    });
  const Endpoint = builder.objectRef<ListedEndpoint>('WebhookEndpoint').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      url: t.exposeString('url'),
      enabled: t.exposeBoolean('enabled'),
      events: t.stringList({ resolve: (e) => list(e.events) }),
      allowlist: t.stringList({ resolve: (e) => list(e.allowlist) }),
      alertEmail: t.exposeString('alertEmail', { nullable: true }),
      retrying: t.exposeInt('retrying'),
      problem: t.exposeString('problem', { nullable: true }),
      lastDelivery: t.exposeString('lastDelivery', { nullable: true }),
      secretRotated: t.exposeString('secretRotated', { nullable: true }),
    }),
  });
  const Integrations = builder.objectRef<IntegrationsView>('PeopleIntegrations').implement({
    fields: (t) => ({
      schemaVersion: t.exposeInt('schemaVersion'),
      deliveries24h: t.exposeInt('deliveries24h'),
      events: t.stringList({ resolve: (v) => list(v.events) }),
      fields: t.field({ type: [IntegrationField], resolve: (v) => list(v.fields) }),
      endpoints: t.field({ type: [Endpoint], resolve: (v) => list(v.endpoints) }),
    }),
  });

  /* ----------------------------------------------------- export, analytics -- */

  type Builder_ = ExportBuilderView;
  const Who = builder.objectRef<Builder_['who'][number]>('ExportAudience').implement({
    fields: (t) => ({
      value: t.exposeString('value'),
      label: t.exposeString('label'),
      count: t.exposeInt('count'),
    }),
  });
  const ExportField = builder
    .objectRef<Builder_['sections'][number]['fields'][number]>('ExportField')
    .implement({
      fields: (t) => ({ key: t.exposeString('key'), label: t.exposeString('label') }),
    });
  const ExportSection = builder
    .objectRef<Builder_['sections'][number]>('ExportSection')
    .implement({
      fields: (t) => ({
        key: t.exposeString('key'),
        label: t.exposeString('label'),
        fields: t.field({ type: [ExportField], resolve: (s) => list(s.fields) }),
      }),
    });
  const ExportBuilder = builder.objectRef<Builder_>('PeopleExportBuilder').implement({
    description: 'Only what the requester can read is offered (§15.1).',
    fields: (t) => ({
      today: t.exposeString('today'),
      who: t.field({ type: [Who], resolve: (v) => list(v.who) }),
      sections: t.field({ type: [ExportSection], resolve: (v) => list(v.sections) }),
    }),
  });

  type A = AnalyticsView;
  const Point = builder
    .objectRef<A['headcount']['trend'][number]>('AnalyticsPoint')
    .implement({
      fields: (t) => ({ label: t.exposeString('label'), value: t.exposeFloat('value') }),
    });
  const Headcount = builder.objectRef<A['headcount']>('AnalyticsHeadcount').implement({
    fields: (t) => ({
      value: t.exposeInt('value'),
      change: t.exposeInt('change', { nullable: true }),
      trend: t.field({ type: [Point], resolve: (h) => list(h.trend) }),
    }),
  });
  const Attrition = builder.objectRef<NonNullable<A['attrition']>>('AnalyticsAttrition').implement({
    fields: (t) => ({
      percent: t.exposeFloat('percent'),
      leavers: t.exposeInt('leavers'),
      formula: t.exposeString('formula'),
      trend: t.field({
        type: [Point],
        description: 'Rolling 12-month attrition, in percent, by month',
        resolve: (a) => list(a.trend),
      }),
    }),
  });
  const TenureBand = builder
    .objectRef<NonNullable<A['tenure']>[number]>('AnalyticsTenureBand')
    .implement({
      fields: (t) => ({
        label: t.exposeString('label'),
        headcount: t.exposeInt('headcount'),
        leavers: t.exposeInt('leavers', {
          description: 'Left in the 12 months before, by tenure at leaving',
        }),
      }),
    });
  type Joiners = NonNullable<A['joiners']>;
  const HeatCell = builder.objectRef<Joiners['cells'][number]>('AnalyticsHeatCell').implement({
    fields: (t) => ({
      row: t.exposeString('row'),
      column: t.exposeString('column'),
      value: t.exposeInt('value'),
    }),
  });
  const JoinerHeatmap = builder.objectRef<Joiners>('AnalyticsJoiners').implement({
    fields: (t) => ({
      months: t.exposeStringList('months'),
      departments: t.exposeStringList('departments'),
      cells: t.field({ type: [HeatCell], resolve: (j) => list(j.cells) }),
    }),
  });
  type Composition = NonNullable<A['composition']>;
  const Series = builder.objectRef<Composition['series'][number]>('AnalyticsSeries').implement({
    fields: (t) => ({
      label: t.exposeString('label'),
      values: t.exposeIntList('values'),
    }),
  });
  const CompositionRef = builder.objectRef<Composition>('AnalyticsComposition').implement({
    fields: (t) => ({
      categories: t.exposeStringList('categories'),
      series: t.field({ type: [Series], resolve: (c) => list(c.series) }),
    }),
  });
  const SelfId = builder.objectRef<NonNullable<A['selfId']>[number]>('AnalyticsSelfId').implement({
    description:
      'One self-identification question in aggregate, from its monthly publication (§6.7, §16.1).',
    fields: (t) => ({
      key: t.exposeString('key'),
      label: t.exposeString('label'),
      status: t.exposeString('status', {
        description: 'ok, or insufficient_data below the cohort minimum',
      }),
      minimum: t.exposeInt('minimum', { nullable: true }),
      publishedAsOf: t.exposeString('publishedAsOf', { nullable: true }),
      total: t.exposeInt('total', {
        nullable: true,
        description: 'Rounded to 5 on its own; not the sum of the rounded counts',
      }),
      note: t.exposeString('note'),
      cells: t.field({ type: [Point], resolve: (c) => list(c.cells) }),
    }),
  });
  const Complete = builder.objectRef<NonNullable<A['complete']>>('AnalyticsComplete').implement({
    fields: (t) => ({
      percent: t.exposeFloat('percent'),
      incomplete: t.exposeInt('incomplete'),
    }),
  });
  const Movement = builder.objectRef<NonNullable<A['movement']>>('AnalyticsMovement').implement({
    fields: (t) => ({
      period: t.exposeString('period'),
      opening: t.exposeInt('opening'),
      joiners: t.exposeInt('joiners'),
      moves: t.exposeInt('moves'),
      leavers: t.exposeInt('leavers'),
      closing: t.exposeInt('closing'),
    }),
  });
  type Expiries = NonNullable<A['expiries']>;
  const Expiry = builder.objectRef<Expiries['items'][number]>('AnalyticsExpiry').implement({
    description: 'One dated value about to lapse, shown only when the viewer reads it on that person.',
    fields: (t) => ({
      kind: t.exposeString('kind', {
        description: 'work_permit, fixed_term, probation or certification',
      }),
      personId: t.exposeID('personId'),
      name: t.exposeString('name', { nullable: true }),
      day: t.exposeString('day', { description: "A calendar date, on the person's own day" }),
    }),
  });
  const ExpiryTimeline = builder.objectRef<Expiries>('AnalyticsExpiries').implement({
    fields: (t) => ({
      today: t.exposeString('today'),
      items: t.field({ type: [Expiry], resolve: (e) => list(e.items) }),
    }),
  });
  type Pay = NonNullable<A['pay']>;
  const PayBandFigures = builder
    .objectRef<NonNullable<Pay['grade'][number]['band']>>('AnalyticsPayBand')
    .implement({
      description: 'The band in force for a grade and currency, in minor units.',
      fields: (t) => ({
        minimumMinor: t.exposeString('minimumMinor'),
        midpointMinor: t.exposeString('midpointMinor'),
        maximumMinor: t.exposeString('maximumMinor'),
      }),
    });
  const PayGroup = builder.objectRef<Pay['grade'][number]>('AnalyticsPayGroup').implement({
    description:
      'Quartiles for one group in one currency, or insufficient_data with no count and no figure (PEO-078).',
    fields: (t) => ({
      label: t.exposeString('label'),
      currency: t.exposeString('currency'),
      status: t.exposeString('status', {
        description: 'ok, or insufficient_data below the cohort minimum',
      }),
      people: t.exposeInt('people', { nullable: true }),
      p25: t.exposeString('p25', {
        nullable: true,
        description: 'Minor units for salary; a ratio to four places for compa-ratio',
      }),
      median: t.exposeString('median', { nullable: true }),
      p75: t.exposeString('p75', { nullable: true }),
      band: t.field({ type: PayBandFigures, nullable: true, resolve: (g) => g.band }),
    }),
  });
  const PayRef = builder.objectRef<Pay>('AnalyticsPay').implement({
    description:
      'Pay in aggregate, finance only: quartiles per group, never a minimum, a maximum or a person (PEO-078).',
    fields: (t) => ({
      asOf: t.exposeString('asOf', { nullable: true }),
      minimum: t.exposeInt('minimum', { description: 'The cohort minimum in force' }),
      grade: t.field({ type: [PayGroup], resolve: (p) => list(p.grade) }),
      tenure: t.field({ type: [PayGroup], resolve: (p) => list(p.tenure) }),
      compa: t.field({ type: [PayGroup], resolve: (p) => list(p.compa) }),
    }),
  });
  const Analytics = builder.objectRef<A>('PeopleAnalytics').implement({
    description:
      'A null figure is one the viewer may not see, or one the cohort minimum suppresses (§11).',
    fields: (t) => ({
      asOf: t.exposeString('asOf'),
      source: t.exposeString('source'),
      sourceNote: t.exposeString('sourceNote'),
      headcount: t.field({ type: Headcount, resolve: (v) => v.headcount }),
      attrition: t.field({ type: Attrition, nullable: true, resolve: (v) => v.attrition }),
      complete: t.field({ type: Complete, nullable: true, resolve: (v) => v.complete }),
      expiringIn90Days: t.exposeInt('expiringIn90Days', { nullable: true }),
      expiries: t.field({ type: ExpiryTimeline, nullable: true, resolve: (v) => v.expiries }),
      movement: t.field({ type: Movement, nullable: true, resolve: (v) => v.movement }),
      completenessBySection: t.field({
        type: [Point],
        nullable: true,
        resolve: (v) => (v.completenessBySection === null ? null : list(v.completenessBySection)),
      }),
      segment: t.field({ type: SegmentRef, nullable: true, resolve: (v) => v.segment }),
      segments: t.field({ type: [SegmentRef], resolve: (v) => list(v.segments) }),
      tenure: t.field({
        type: [TenureBand],
        nullable: true,
        resolve: (v) => (v.tenure === null ? null : list(v.tenure)),
      }),
      span: t.field({
        type: [Point],
        nullable: true,
        description: 'Managers by number of direct reports',
        resolve: (v) => (v.span === null ? null : list(v.span)),
      }),
      joiners: t.field({ type: JoinerHeatmap, nullable: true, resolve: (v) => v.joiners }),
      composition: t.field({
        type: CompositionRef,
        nullable: true,
        resolve: (v) => v.composition,
      }),
      selfId: t.field({
        type: [SelfId],
        nullable: true,
        description: "HR's only; never under a segment",
        resolve: (v) => (v.selfId === null ? null : list(v.selfId)),
      }),
      pay: t.field({
        type: PayRef,
        nullable: true,
        description: "Finance's only; never under a segment",
        resolve: (v) => v.pay,
      }),
    }),
  });

  const SegmentCondition = builder
    .objectRef<SegmentView['filter'][number]>('PeopleSegmentCondition')
    .implement({
      fields: (t) => ({ key: t.exposeString('key'), value: t.exposeString('value') }),
    });
  const SegmentUse = builder.objectRef<SegmentView['usableIn']>('PeopleSegmentUse').implement({
    fields: (t) => ({
      directory: t.exposeBoolean('directory'),
      analytics: t.exposeBoolean('analytics'),
    }),
  });
  const Segment = builder.objectRef<SegmentView>('PeopleSegment').implement({
    description:
      'A saved segment (PEO-068): a filter, never a list of people. Using it shows you only the people you may see.',
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      filter: t.field({ type: [SegmentCondition], resolve: (v) => list(v.filter) }),
      shared: t.exposeBoolean('shared'),
      mine: t.exposeBoolean('mine'),
      usableIn: t.field({ type: SegmentUse, resolve: (v) => v.usableIn }),
    }),
  });

  /* ---------------------------------------------------------- import -- */

  type Stage = ImportStageView;
  const FileRef = builder.objectRef<Stage['file']>('ImportFile').implement({
    fields: (t) => ({
      name: t.exposeString('name'),
      rows: t.exposeInt('rows'),
      sheet: t.exposeString('sheet', { nullable: true }),
    }),
  });
  const Mapping = builder.objectRef<ColumnMapping>('ImportColumn').implement({
    fields: (t) => ({
      index: t.exposeInt('index'),
      header: t.exposeString('header'),
      status: t.exposeString('status'),
      key: t.exposeString('key', { nullable: true }),
      source: t.exposeString('source', { nullable: true }),
      confidence: t.exposeFloat('confidence', { nullable: true }),
      reason: t.exposeString('reason', { nullable: true }),
    }),
  });
  const ImportTarget = builder
    .objectRef<{ readonly key: string; readonly label: string }>('ImportTarget')
    .implement({ fields: (t) => ({ key: t.exposeString('key'), label: t.exposeString('label') }) });
  type Review = Extract<Stage, { step: 'review' }>;
  type DryRun = Review['dryRun'];
  const Counts = builder.objectRef<DryRun['counts']>('ImportCounts').implement({
    fields: (t) => ({
      create: t.exposeInt('create'),
      update: t.exposeInt('update'),
      unchanged: t.exposeInt('unchanged'),
      blocked: t.exposeInt('blocked'),
      duplicate: t.exposeInt('duplicate'),
    }),
  });
  const ByField = builder
    .objectRef<DryRun['incomplete']['byField'][number]>('ImportIncompleteField')
    .implement({ fields: (t) => ({ label: t.exposeString('label'), count: t.exposeInt('count') }) });
  const Incomplete = builder.objectRef<DryRun['incomplete']>('ImportIncomplete').implement({
    fields: (t) => ({
      count: t.exposeInt('count'),
      byField: t.field({ type: [ByField], resolve: (i) => list(i.byField) }),
    }),
  });
  const Blocked = builder.objectRef<DryRun['blocked'][number]>('ImportBlockedRow').implement({
    fields: (t) => ({
      row: t.exposeInt('row'),
      person: t.exposeString('person', { nullable: true }),
      problem: t.exposeString('problem'),
      cell: t.exposeString('cell'),
    }),
  });
  const Sheet = builder.objectRef<DryRun['sheets'][number]>('ImportSheet').implement({
    description: 'A repeating attribute’s sheet; one not imported is listed, never dropped.',
    fields: (t) => ({
      sheet: t.exposeString('sheet'),
      key: t.exposeString('key'),
      imported: t.exposeBoolean('imported'),
    }),
  });
  const Correction = builder
    .objectRef<DryRun['corrections'][number]>('ImportHireDateCorrection')
    .implement({
      fields: (t) => ({
        row: t.exposeInt('row'),
        from: t.exposeString('from', { nullable: true }),
        to: t.exposeString('to'),
      }),
    });
  const CellFindingRef = builder
    .objectRef<DryRun['findings'][number]>('ImportCellFinding')
    .implement({
      description: 'A cell our checks doubt. Named by its reference, never by its value.',
      fields: (t) => ({
        row: t.exposeInt('row'),
        cell: t.exposeString('cell'),
        label: t.exposeString('label'),
        level: t.exposeString('level'),
        message: t.exposeString('message'),
      }),
    });
  const DryRunRef = builder.objectRef<DryRun>('ImportDryRun').implement({
    fields: (t) => ({
      counts: t.field({ type: Counts, resolve: (d) => d.counts }),
      incomplete: t.field({ type: Incomplete, resolve: (d) => d.incomplete }),
      ignoredColumns: t.stringList({ resolve: (d) => list(d.ignoredColumns) }),
      sheets: t.field({ type: [Sheet], resolve: (d) => list(d.sheets) }),
      corrections: t.field({ type: [Correction], resolve: (d) => list(d.corrections) }),
      blocked: t.field({ type: [Blocked], resolve: (d) => list(d.blocked) }),
      findings: t.field({
        type: [CellFindingRef],
        description: 'Doubted national identifiers, per cell: imported, then reviewed by HR (PEO-125).',
        resolve: (d) => list(d.findings),
      }),
    }),
  });
  const MapStage = builder.objectRef<Extract<Stage, { step: 'map' }>>('ImportMapStage').implement({
    fields: (t) => ({
      step: t.exposeString('step'),
      file: t.field({ type: FileRef, resolve: (s) => s.file }),
      columns: t.field({ type: [Mapping], resolve: (s) => list(s.columns) }),
      fields: t.field({ type: [ImportTarget], resolve: (s) => list(s.fields) }),
    }),
  });
  const ReviewStage = builder.objectRef<Review>('ImportReviewStage').implement({
    fields: (t) => ({
      step: t.exposeString('step'),
      file: t.field({ type: FileRef, resolve: (s) => s.file }),
      dryRun: t.field({ type: DryRunRef, resolve: (s) => s.dryRun }),
      blockedUrl: t.exposeString('blockedUrl', {
        nullable: true,
        description:
          'The blocked rows as a CSV that imports once fixed: a signed link that expires with the upload or in a day. Null when nothing is blocked.',
      }),
    }),
  });
  const DoneStage = builder
    .objectRef<Extract<Stage, { step: 'done' }>>('ImportDoneStage')
    .implement({
      fields: (t) => ({
        step: t.exposeString('step'),
        file: t.field({ type: FileRef, resolve: (s) => s.file }),
        created: t.exposeInt('created'),
        updated: t.exposeInt('updated'),
        blocked: t.exposeInt('blocked'),
        reportUrl: t.exposeString('reportUrl', {
          description: 'The same report, stored sealed; a signed link that expires in a day.',
        }),
        forReview: t.exposeInt('forReview', {
          description: 'Doubted national identifiers that imported and went to HR’s review.',
        }),
      }),
    });
  const UploadHeader = builder
    .objectRef<{ readonly name: string; readonly value: string }>('ImportUploadHeader')
    .implement({
      fields: (t) => ({ name: t.exposeString('name'), value: t.exposeString('value') }),
    });
  const UploadTarget = builder.objectRef<ImportUploadView>('ImportUploadTarget').implement({
    description:
      'Where the browser puts the file: a presigned PUT, straight to storage, for exactly this file, once.',
    fields: (t) => ({
      uploadId: t.exposeID('uploadId'),
      url: t.exposeString('url'),
      method: t.exposeString('method'),
      headers: t.field({
        type: [UploadHeader],
        description: 'Send exactly these; each is signed. A browser sets content-length itself.',
        resolve: (u) => Object.entries(u.headers).map(([name, value]) => ({ name, value })),
      }),
      expiresAt: t.exposeString('expiresAt'),
    }),
  });
  const ImportStage = builder.unionType('ImportStage', {
    types: [MapStage, ReviewStage, DoneStage],
    resolveType: (s) =>
      s.step === 'map' ? 'ImportMapStage' : s.step === 'review' ? 'ImportReviewStage' : 'ImportDoneStage',
  });

  /* ------------------------------------------------ exports, full values -- */

  interface ExportAnswer {
    readonly id: string;
    readonly status: string;
    readonly rowCount: number | null;
    readonly expiresAt: string | null;
    readonly links: readonly { readonly name: string; readonly url: string }[];
  }
  const Link = builder.objectRef<ExportAnswer['links'][number]>('ExportLink').implement({
    description: 'A signed link that expires (PEO-089); it carries its own authority.',
    fields: (t) => ({ name: t.exposeString('name'), url: t.exposeString('url') }),
  });
  const ExportRef = builder.objectRef<ExportAnswer>('PeopleExport').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      status: t.exposeString('status', { description: 'queued, completed or expired' }),
      rowCount: t.exposeInt('rowCount', { nullable: true }),
      expiresAt: t.exposeString('expiresAt', { nullable: true }),
      links: t.field({ type: [Link], resolve: (e) => list(e.links) }),
    }),
  });

  interface FullValuesAnswer {
    readonly id: string;
    readonly state: string;
    readonly requestedBy: string;
    readonly reason: string;
    readonly attributeKeys: readonly string[];
    readonly expiresAt: string;
    readonly decidedBy: string | null;
    readonly link: string | null;
  }
  const FullValues = builder.objectRef<FullValuesAnswer>('FullValuesRequest').implement({
    description: 'Finance asks, HR decides, one download (PEO-088).',
    fields: (t) => ({
      id: t.exposeID('id'),
      state: t.exposeString('state'),
      requestedBy: t.exposeID('requestedBy'),
      reason: t.exposeString('reason'),
      attributeKeys: t.stringList({ resolve: (r) => list(r.attributeKeys) }),
      expiresAt: t.exposeString('expiresAt'),
      decidedBy: t.exposeID('decidedBy', { nullable: true }),
      link: t.exposeString('link', {
        nullable: true,
        description: 'The one download, for the requester only, until used or 24 hours pass.',
      }),
    }),
  });

  const DeliveryRef = builder
    .objectRef<DeliveriesView['deliveries'][number]>('WebhookDelivery')
    .implement({
      description: 'What was sent and how it went; never the body.',
      fields: (t) => ({
        id: t.exposeID('id'),
        eventName: t.exposeString('eventName'),
        status: t.exposeString('status', { description: 'pending, delivered, failed or skipped' }),
        attempts: t.exposeInt('attempts'),
        lastResponse: t.exposeInt('lastResponse', { nullable: true }),
        createdAt: t.exposeString('createdAt'),
        deliveredAt: t.exposeString('deliveredAt', { nullable: true }),
        replayOf: t.exposeID('replayOf', { nullable: true }),
      }),
    });
  const DeliveryEndpoint = builder
    .objectRef<DeliveriesView['endpoint']>('WebhookDeliveryEndpoint')
    .implement({
      fields: (t) => ({
        id: t.exposeID('id'),
        url: t.exposeString('url'),
        enabled: t.exposeBoolean('enabled'),
      }),
    });
  const DeliveriesRef = builder.objectRef<DeliveriesView>('WebhookDeliveries').implement({
    fields: (t) => ({
      endpoint: t.field({ type: DeliveryEndpoint, resolve: (d) => d.endpoint }),
      deliveries: t.field({ type: [DeliveryRef], resolve: (d) => list(d.deliveries) }),
      next: t.exposeID('next', { nullable: true }),
    }),
  });

  type Screen = FullValuesScreen;
  const FullValuesField = builder
    .objectRef<Screen['fields'][number]>('FullValuesField')
    .implement({
      fields: (t) => ({ key: t.exposeString('key'), label: t.exposeString('label') }),
    });
  const FullValuesItem = builder
    .objectRef<Screen['requests'][number]>('FullValuesListed')
    .implement({
      fields: (t) => ({
        id: t.exposeID('id'),
        state: t.exposeString('state'),
        mine: t.exposeBoolean('mine'),
        requestedBy: t.exposeString('requestedBy', { nullable: true }),
        reason: t.exposeString('reason'),
        fields: t.stringList({ resolve: (r) => list(r.fields) }),
        requestedAt: t.exposeString('requestedAt'),
        expiresAt: t.exposeString('expiresAt'),
        note: t.exposeString('note', { nullable: true }),
        link: t.exposeString('link', {
          nullable: true,
          description: 'The one download, for the requester only, until used or 24 hours pass.',
        }),
      }),
    });
  const FullValuesScreenRef = builder.objectRef<Screen>('PeopleFullValues').implement({
    description: 'Finance’s own requests for full values, or every one for HR (PEO-121).',
    fields: (t) => ({
      canRequest: t.exposeBoolean('canRequest'),
      canDecide: t.exposeBoolean('canDecide'),
      fields: t.field({ type: [FullValuesField], resolve: (s) => list(s.fields) }),
      requests: t.field({ type: [FullValuesItem], resolve: (s) => list(s.requests) }),
    }),
  });

  /* ------------------------------------------------------------- queries -- */

  const view =
    <T>(path: (args: Record<string, unknown>) => string) =>
    (_root: unknown, args: Record<string, unknown>, ctx: RequestContext): Promise<T> =>
      viaRest<T>(ctx, 'GET', path(args));

  builder.queryFields((t) => ({
    peopleOnboarding: t.field({
      type: Onboarding,
      resolve: view<OnboardingView>(() => '/v1/views/onboarding'),
    }),
    peopleProfile: t.field({
      type: Profile,
      description: 'One person as the viewer may see them; no id is "my profile".',
      args: { personId: t.arg.id() },
      resolve: (_root, args, ctx) =>
        viaRest<ProfileView>(
          ctx,
          'GET',
          args.personId === null || args.personId === undefined
            ? '/v1/views/profile'
            : `/v1/views/profile/${encodeURIComponent(args.personId)}`,
        ),
    }),
    peopleHistory: t.field({
      type: HistoryRef,
      description:
        'One person as of a date (default today), and every change; no id is "my history".',
      args: { personId: t.arg.id(), asOf: t.arg.string() },
      resolve: (_root, args, ctx) =>
        viaRest<HistoryView>(
          ctx,
          'GET',
          `/v1/views/history${
            args.personId === null || args.personId === undefined
              ? ''
              : `/${encodeURIComponent(args.personId)}`
          }${args.asOf ? `?asOf=${encodeURIComponent(args.asOf)}` : ''}`,
        ),
    }),
    peopleDirectory: t.field({
      type: DirectoryRef,
      args: {
        search: t.arg.string(),
        filter: t.arg.string(),
        after: t.arg.id(),
        segment: t.arg.id(),
      },
      resolve: (_root, args, ctx) => {
        const query = new URLSearchParams();
        if (args.search) query.set('search', args.search);
        if (args.filter) query.set('filter', args.filter);
        if (args.segment) query.set('segment', args.segment);
        if (args.after) query.set('after', args.after);
        const qs = query.toString();
        return viaRest<DirectoryView>(ctx, 'GET', `/v1/views/directory${qs === '' ? '' : `?${qs}`}`);
      },
    }),
    peopleCompleteness: t.field({
      type: CompletenessRef,
      args: { after: t.arg.id() },
      resolve: (_root, args, ctx) =>
        viaRest<CompletenessView>(
          ctx,
          'GET',
          args.after
            ? `/v1/views/completeness?after=${encodeURIComponent(args.after)}`
            : '/v1/views/completeness',
        ),
    }),
    peoplePicker: t.field({
      type: Picker,
      description: 'People whose name matches, as this viewer may read them.',
      args: { search: t.arg.string(), after: t.arg.id() },
      resolve: (_root, args, ctx) => {
        const query = new URLSearchParams();
        if (args.search) query.set('search', args.search);
        if (args.after) query.set('after', args.after);
        const qs = query.toString();
        return viaRest<PickerView>(ctx, 'GET', `/v1/views/people-picker${qs === '' ? '' : `?${qs}`}`);
      },
    }),
    peopleRoleSettings: t.field({
      type: RoleSettings,
      resolve: view<RolesView>(() => '/v1/views/roles'),
    }),
    peopleRegistry: t.field({
      type: Registry,
      resolve: view<RegistryView>(() => '/v1/views/registry'),
    }),
    peopleSetup: t.field({ type: SetupRef, resolve: view<SetupView>(() => '/v1/views/setup') }),
    peopleIntegrations: t.field({
      type: Integrations,
      resolve: view<IntegrationsView>(() => '/v1/views/integrations'),
    }),
    peopleExportBuilder: t.field({
      type: ExportBuilder,
      resolve: view<ExportBuilderView>(() => '/v1/views/export'),
    }),
    peopleAnalytics: t.field({
      type: Analytics,
      args: { segment: t.arg.id() },
      resolve: (_root, args, ctx) =>
        viaRest<AnalyticsView>(
          ctx,
          'GET',
          args.segment
            ? `/v1/views/analytics?segment=${encodeURIComponent(args.segment)}`
            : '/v1/views/analytics',
        ),
    }),
    peopleSegments: t.field({
      type: [Segment],
      description: 'The saved segments you see and could use somewhere (PEO-068).',
      resolve: async (_root, _args, ctx) =>
        list((await viaRest<{ items: SegmentView[] }>(ctx, 'GET', '/v1/segments')).items),
    }),
    peopleExport: t.field({
      type: ExportRef,
      description: 'The requester’s own export, its links signed again.',
      args: { id: t.arg.id({ required: true }) },
      resolve: (_root, args, ctx) =>
        viaRest<ExportAnswer>(ctx, 'GET', `/v1/exports/${encodeURIComponent(args.id)}`),
    }),
    peopleWebhookDeliveries: t.field({
      type: DeliveriesRef,
      description: 'One endpoint’s delivery log, newest first, 50 at a time; people_admin only.',
      args: { endpointId: t.arg.id({ required: true }), after: t.arg.id() },
      resolve: (_root, args, ctx) =>
        viaRest<DeliveriesView>(
          ctx,
          'GET',
          `/v1/webhooks/endpoints/${encodeURIComponent(args.endpointId)}/deliveries${
            args.after ? `?after=${encodeURIComponent(args.after)}` : ''
          }`,
        ),
    }),
    peopleFullValues: t.field({
      type: FullValuesScreenRef,
      resolve: view<Screen>(() => '/v1/exports/full-values'),
    }),
    fullValuesRequest: t.field({
      type: FullValues,
      args: { id: t.arg.id({ required: true }) },
      resolve: (_root, args, ctx) =>
        viaRest<FullValuesAnswer>(
          ctx,
          'GET',
          `/v1/exports/full-values/${encodeURIComponent(args.id)}`,
        ),
    }),
  }));

  /* ------------------------------------------------------------- inputs -- */

  const MoneyValueInput = builder.inputType('FormMoneyInput', {
    fields: (t) => ({
      amountMinor: t.string({ required: true }),
      currency: t.string({ required: true }),
    }),
  });
  const FormValueInput = builder.inputType('FormValueInput', {
    description: 'One value as a form holds it, in exactly one slot; clear: true empties it.',
    fields: (t) => ({
      key: t.string({ required: true }),
      text: t.string(),
      flag: t.boolean(),
      items: t.stringList(),
      money: t.field({ type: MoneyValueInput }),
      clear: t.boolean(),
    }),
  });
  const SegmentConditionInput = builder.inputType('PeopleSegmentConditionInput', {
    fields: (t) => ({
      key: t.string({ required: true }),
      value: t.string({ required: true }),
    }),
  });
  const CellInput = builder.inputType('GridCellInput', {
    fields: (t) => ({ key: t.string({ required: true }), value: t.string({ required: true }) }),
  });
  const GridChange = builder.inputType('GridChangeInput', {
    fields: (t) => ({
      personId: t.id({ required: true }),
      values: t.field({ type: [CellInput], required: true }),
    }),
  });
  const ClauseInput = builder.inputType('PredicateClauseInput', {
    fields: (t) => ({
      operand: t.string({ required: true }),
      in: t.stringList(),
      key: t.string(),
      is: t.string(),
      equals: t.string(),
    }),
  });
  const PredicateInput = builder.inputType('PersonPredicateInput', {
    fields: (t) => ({
      combine: t.string({ required: true }),
      clauses: t.field({ type: [ClauseInput], required: true }),
    }),
  });
  const RuleInput = builder.inputType('VisibilityRuleInput', {
    fields: (t) => ({
      scopes: t.stringList({ required: true }),
      when: t.field({ type: PredicateInput, required: true }),
    }),
  });
  const DraftField = builder.inputType('DraftFieldInput', {
    fields: (t) => ({
      key: t.string({ required: true }),
      sectionKey: t.string({ required: true }),
      label: t.string({ required: true }),
      description: t.string(),
      dataType: t.string({ required: true }),
      options: t.stringList({ required: true }),
      requiredness: t.string({ required: true }),
      requiredWhen: t.field({ type: PredicateInput }),
      ownership: t.stringList({ required: true }),
      collectAt: t.string({ required: true }),
      visibility: t.stringList({ required: true }),
      visibilityRules: t.field({ type: [RuleInput] }),
      classification: t.string({ required: true }),
      piiKind: t.string({ required: true }),
      classificationSource: t.string({ required: true }),
    }),
  });
  const ColumnInput = builder.inputType('ImportColumnInput', {
    description: 'Column index → attribute key; no key ignores the column.',
    fields: (t) => ({ column: t.int({ required: true }), key: t.string() }),
  });

  /* ---------------------------------------------------------- mutations -- */

  const Outcome = builder.objectRef<{ ok: true }>('WriteOutcome').implement({
    fields: (t) => ({ ok: t.boolean({ resolve: () => true }) }),
  });
  const done = () => ({ ok: true as const });
  const Version = builder.objectRef<{ version: number | null }>('PublishedVersionNumber').implement({
    fields: (t) => ({ version: t.exposeInt('version', { nullable: true }) }),
  });
  const Secret = builder
    .objectRef<{ id: string; secret: string | null }>('WebhookEndpointSecret')
    .implement({
      fields: (t) => ({
        id: t.exposeID('id'),
        secret: t.exposeString('secret', {
          nullable: true,
          description: 'Shown once. Null when a retry of the same key answers: rotate again.',
        }),
      }),
    });
  const Replayed = builder.objectRef<{ deliveryId: string }>('WebhookReplay').implement({
    fields: (t) => ({ deliveryId: t.exposeID('deliveryId') }),
  });

  type FormInput = typeof FormValueInput.$inferInput;
  /** The one slot that was filled; the application checks it against the field. */
  const changed = (inputs: readonly FormInput[]): Record<string, unknown> =>
    Object.fromEntries(
      inputs.map((i) => [
        i.key,
        i.clear === true
          ? null
          : (i.text ?? i.flag ?? i.items ?? (i.money ? { ...i.money } : undefined)),
      ]),
    );

  const importStep = (
    uploadId: string,
    mapping: readonly { column: number; key?: string | null | undefined }[],
  ) => ({
    uploadId,
    mapping: Object.fromEntries(mapping.map((m) => [m.column, m.key ?? null])),
  });

  /** What a section save answers: a retry answers `{ ok }` alone, so findings default to none. */
  const saved = (answer: { findings?: readonly IdentifierFindingView[] } | null) => ({
    ok: true as const,
    findings: answer?.findings ?? [],
  });
  const SectionSaved = builder
    .objectRef<{ ok: true; findings: readonly IdentifierFindingView[] }>('SectionSaved')
    .implement({
      fields: (t) => ({
        ok: t.boolean({ resolve: () => true }),
        findings: t.field({
          type: [FindingNoticeRef],
          description: 'Warnings on national identifiers the save carried (PEO-125); saved all the same.',
          resolve: (v) => list(v.findings),
        }),
      }),
    });
  const Decided = builder
    .objectRef<{ reviewId: string; personId: string; attributeKey: string; state: string }>(
      'IdentifierDecision',
    )
    .implement({
      fields: (t) => ({
        reviewId: t.exposeID('reviewId'),
        personId: t.exposeID('personId'),
        attributeKey: t.exposeString('attributeKey'),
        state: t.exposeString('state', { description: 'accepted or sent_back' }),
      }),
    });
  const Revealed = builder
    .objectRef<{ attributeKey: string; value: string }>('IdentifierRevealed')
    .implement({
      description: 'The value in full, for HR deciding it. Audited.',
      fields: (t) => ({
        attributeKey: t.exposeString('attributeKey'),
        value: t.exposeString('value'),
      }),
    });
  type GridFinding = IdentifierFindingView & { personId: string };
  const GridFindingRef = builder.objectRef<GridFinding>('GridCellFinding').implement({
    description: 'A grid cell our checks doubt (PEO-125): saved all the same, and reviewed by HR.',
    fields: (t) => ({
      personId: t.exposeID('personId'),
      key: t.exposeString('key'),
      label: t.exposeString('label'),
      level: t.exposeString('level'),
      code: t.exposeString('code'),
      message: t.exposeString('message'),
      review: t.exposeString('review', { description: 'pending, accepted, sent_back or none' }),
    }),
  });
  const GridSaved = builder
    .objectRef<{ ok: true; findings: readonly GridFinding[] }>('GridSaved')
    .implement({
      fields: (t) => ({
        ok: t.boolean({ resolve: () => true }),
        findings: t.field({ type: [GridFindingRef], resolve: (v) => list(v.findings) }),
      }),
    });
  const GridChecked = builder
    .objectRef<{ findings: readonly GridFinding[] }>('GridIdentifierCheck')
    .implement({
      fields: (t) => ({
        findings: t.field({ type: [GridFindingRef], resolve: (v) => list(v.findings) }),
      }),
    });
  /** The grid's cells as REST takes them. */
  const gridChanges = (
    changes: readonly { personId: string | number; values: readonly { key: string; value: string }[] }[],
  ) =>
    changes.map((c) => ({
      personId: String(c.personId),
      values: Object.fromEntries(c.values.map((v) => [v.key, v.value])),
    }));
  builder.queryField('peopleGridCheck', (t) =>
    t.field({
      type: GridChecked,
      description: 'What saving these grid cells would be warned about (PEO-125); nothing is kept.',
      args: { changes: t.arg({ type: [GridChange], required: true }) },
      resolve: (_root, args, ctx) =>
        viaRest<{ findings: GridFinding[] }>(ctx, 'POST', '/v1/views/completeness/identifier-check', {
          body: { changes: gridChanges(args.changes) },
        }),
    }),
  );
  const IdentifierDecisionEnum = builder.enumType('IdentifierReviewDecision', {
    values: ['accept', 'send_back'] as const,
  });

  builder.mutationFields((t) => ({
    saveOwnSection: t.field({
      type: SectionSaved,
      args: {
        changed: t.arg({ type: [FormValueInput], required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) =>
        saved(
          await viaRest<{ findings?: IdentifierFindingView[] } | null>(
            ctx,
            'POST',
            '/v1/views/me/sections',
            { body: { changed: changed(args.changed) }, key: args.idempotencyKey },
          ),
        ),
    }),
    savePersonSection: t.field({
      type: SectionSaved,
      args: {
        personId: t.arg.id({ required: true }),
        changed: t.arg({ type: [FormValueInput], required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) =>
        saved(
          await viaRest<{ findings?: IdentifierFindingView[] } | null>(
            ctx,
            'POST',
            `/v1/views/people/${encodeURIComponent(args.personId)}/sections`,
            { body: { changed: changed(args.changed) }, key: args.idempotencyKey },
          ),
        ),
    }),
    reviewIdentifier: t.field({
      type: Decided,
      description:
        'HR decides a doubted identifier (PEO-125): accept is final; send_back asks the employee to correct it.',
      args: {
        personId: t.arg.id({ required: true }),
        attributeKey: t.arg.string({ required: true }),
        decision: t.arg({ type: IdentifierDecisionEnum, required: true }),
        note: t.arg.string(),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: (_root, { personId, idempotencyKey, ...decision }, ctx) =>
        viaRest<{ reviewId: string; personId: string; attributeKey: string; state: string }>(
          ctx,
          'POST',
          `/v1/people/${encodeURIComponent(personId)}/identifier-reviews`,
          { body: sent(decision), key: idempotencyKey },
        ),
    }),
    revealIdentifier: t.field({
      type: Revealed,
      description: 'The doubted value in full, for HR deciding it (PEO-125). Audited.',
      args: {
        personId: t.arg.id({ required: true }),
        attributeKey: t.arg.string({ required: true }),
      },
      resolve: (_root, args, ctx) =>
        viaRest<{ attributeKey: string; value: string }>(
          ctx,
          'POST',
          `/v1/people/${encodeURIComponent(args.personId)}/identifier-reviews/reveal`,
          { body: { attributeKey: args.attributeKey } },
        ),
    }),
    saveCompletenessGrid: t.field({
      type: GridSaved,
      args: {
        changes: t.arg({ type: [GridChange], required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) => {
        const answer = await viaRest<{ findings?: GridFinding[] } | null>(
          ctx,
          'POST',
          '/v1/views/completeness',
          { body: { changes: gridChanges(args.changes) }, key: args.idempotencyKey },
        );
        return { ok: true as const, findings: answer?.findings ?? [] };
      },
    }),
    confirmSetupEntity: t.field({
      type: Outcome,
      args: {
        name: t.arg.string({ required: true }),
        country: t.arg.string({ required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) => {
        await viaRest(ctx, 'POST', '/v1/views/setup/entity', {
          body: { name: args.name, country: args.country },
          key: args.idempotencyKey,
        });
        return done();
      },
    }),
    publishSetup: t.field({
      type: Version,
      description: 'The first publish, from a country pack. A retry answers the version in force.',
      args: {
        country: t.arg.string({ required: true }),
        sections: t.arg.stringList({ required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: (_root, args, ctx) =>
        viaRest<{ version: number | null }>(ctx, 'POST', '/v1/views/setup/publish', {
          body: { country: args.country, sections: args.sections },
          key: args.idempotencyKey,
        }),
    }),
    addDraftSection: t.field({
      type: Outcome,
      args: { label: t.arg.string({ required: true }), idempotencyKey: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) => {
        await viaRest(ctx, 'POST', '/v1/schema/draft/sections', {
          body: { label: args.label },
          key: args.idempotencyKey,
        });
        return done();
      },
    }),
    reorderDraftSections: t.field({
      type: Outcome,
      args: { order: t.arg.stringList({ required: true }), idempotencyKey: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) => {
        await viaRest(ctx, 'PUT', '/v1/schema/draft/sections/order', {
          body: { order: args.order },
          key: args.idempotencyKey,
        });
        return done();
      },
    }),
    reorderDraftFields: t.field({
      type: Outcome,
      args: {
        sectionKey: t.arg.string({ required: true }),
        order: t.arg.stringList({ required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) => {
        await viaRest(
          ctx,
          'PUT',
          `/v1/schema/draft/sections/${encodeURIComponent(args.sectionKey)}/order`,
          { body: { order: args.order }, key: args.idempotencyKey },
        );
        return done();
      },
    }),
    saveDraftField: t.field({
      type: Outcome,
      description: 'Add or change a field in the draft; the draft decides whether it may.',
      args: {
        input: t.arg({ type: DraftField, required: true }),
        editing: t.arg.string(),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) => {
        await viaRest(ctx, 'POST', '/v1/schema/draft/attributes', {
          body: {
            input: { ...args.input, description: args.input.description ?? null },
            editing: args.editing ?? null,
          },
          key: args.idempotencyKey,
        });
        return done();
      },
    }),
    publishDraft: t.field({
      type: Version,
      description: 'Publish the draft. A retry answers the version in force.',
      args: { requiredFrom: t.arg.string({ required: true }), idempotencyKey: t.arg.string({ required: true }) },
      resolve: (_root, args, ctx) =>
        viaRest<{ version: number | null }>(ctx, 'POST', '/v1/schema/draft/publish', {
          body: { requiredFrom: args.requiredFrom },
          key: args.idempotencyKey,
        }),
    }),
    createWebhookEndpoint: t.field({
      type: Secret,
      args: {
        url: t.arg.string({ required: true }),
        events: t.arg.stringList({ required: true }),
        allowlist: t.arg.stringList({ required: true }),
        alertEmail: t.arg.string({ required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) => {
        const made = await viaRest<{ id: string; secret?: string }>(
          ctx,
          'POST',
          '/v1/webhooks/endpoints',
          {
            body: {
              url: args.url,
              events: args.events,
              allowlist: args.allowlist,
              alertEmail: args.alertEmail,
            },
            key: args.idempotencyKey,
          },
        );
        return { id: made.id, secret: made.secret ?? null };
      },
    }),
    updateWebhookEndpoint: t.field({
      type: Outcome,
      args: {
        id: t.arg.id({ required: true }),
        url: t.arg.string(),
        events: t.arg.stringList(),
        allowlist: t.arg.stringList(),
        alertEmail: t.arg.string(),
        enabled: t.arg.boolean(),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, { id, idempotencyKey, ...patch }, ctx) => {
        await viaRest(ctx, 'PATCH', `/v1/webhooks/endpoints/${encodeURIComponent(id)}`, {
          body: Object.fromEntries(
            Object.entries(patch).filter(([, v]) => v !== null && v !== undefined),
          ),
          key: idempotencyKey,
        });
        return done();
      },
    }),
    rotateWebhookSecret: t.field({
      type: Secret,
      args: { id: t.arg.id({ required: true }), idempotencyKey: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) => {
        const id = args.id;
        const rotated = await viaRest<{ secret?: string }>(
          ctx,
          'POST',
          `/v1/webhooks/endpoints/${encodeURIComponent(id)}/rotate`,
          { body: {}, key: args.idempotencyKey },
        );
        return { id, secret: rotated.secret ?? null };
      },
    }),
    replayWebhookDelivery: t.field({
      type: Replayed,
      args: { deliveryId: t.arg.id({ required: true }), idempotencyKey: t.arg.string({ required: true }) },
      resolve: (_root, args, ctx) =>
        viaRest<{ deliveryId: string }>(
          ctx,
          'POST',
          `/v1/webhooks/deliveries/${encodeURIComponent(args.deliveryId)}/replay`,
          { body: {}, key: args.idempotencyKey },
        ),
    }),
    startImportUpload: t.field({
      type: UploadTarget,
      description:
        'Where to upload a file to import: a presigned PUT, straight to storage (§14.2). No bytes come this way. Unkeyed: a retry is a fresh upload.',
      args: {
        name: t.arg.string({ required: true }),
        size: t.arg.int({ required: true, description: 'Bytes, exactly: the PUT is signed for this length.' }),
      },
      resolve: (_root, args, ctx) =>
        viaRest<ImportUploadView>(ctx, 'POST', '/v1/imports/uploads', {
          body: { name: args.name, size: args.size },
        }),
    }),
    completeImportUpload: t.field({
      type: ImportStage,
      description: 'The file is uploaded: check it, then the proposed mapping. Changes nothing else.',
      args: { uploadId: t.arg.id({ required: true }) },
      resolve: (_root, args, ctx) =>
        viaRest<Stage>(
          ctx,
          'POST',
          `/v1/imports/uploads/${encodeURIComponent(args.uploadId)}/complete`,
          { body: {} },
        ),
    }),
    dryRunImport: t.field({
      type: ImportStage,
      description: 'The five counts and the blocked rows. Changes nothing, so takes no key.',
      args: {
        uploadId: t.arg.id({ required: true }),
        mapping: t.arg({ type: [ColumnInput], required: true }),
      },
      resolve: (_root, args, ctx) =>
        viaRest<Stage>(ctx, 'POST', '/v1/imports/dry-run', {
          body: importStep(args.uploadId, args.mapping),
        }),
    }),
    commitImport: t.field({
      type: ImportStage,
      description:
        'Import. A retry of the same key is refused ALREADY_IMPORTED: the report is not kept.',
      args: {
        uploadId: t.arg.id({ required: true }),
        mapping: t.arg({ type: [ColumnInput], required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: (_root, args, ctx) =>
        viaRest<Stage>(ctx, 'POST', '/v1/imports', {
          body: importStep(args.uploadId, args.mapping),
          key: args.idempotencyKey,
        }),
    }),
    requestExport: t.field({
      type: ExportRef,
      description: 'Over 2,000 rows the export is queued; ask `peopleExport` for its links.',
      args: {
        format: t.arg.string({ required: true, description: 'csv, xlsx or pdf.' }),
        recordOf: t.arg.id({
          description: 'With pdf: this person’s employee record instead of a roster.',
        }),
        fields: t.arg.stringList(),
        asOf: t.arg.string(),
        includeArchived: t.arg.boolean(),
        personIds: t.arg.idList(),
        filter: t.arg.string(),
        segmentId: t.arg.id(),
        reason: t.arg.string(),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: (_root, { idempotencyKey, ...asked }, ctx) =>
        viaRest<ExportAnswer>(ctx, 'POST', '/v1/exports', {
          body: sent(asked),
          key: idempotencyKey,
        }),
    }),
    savePeopleSegment: t.field({
      type: Segment,
      description: 'Save a named filter, for yourself or shared within the tenant (PEO-068).',
      args: {
        name: t.arg.string({ required: true }),
        filter: t.arg({ type: [SegmentConditionInput], required: true }),
        shared: t.arg.boolean({ required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: (_root, args, ctx) =>
        viaRest<SegmentView>(ctx, 'POST', '/v1/segments', {
          body: {
            name: args.name,
            filter: Object.fromEntries(args.filter.map((c) => [c.key, c.value])),
            shared: args.shared,
          },
          key: args.idempotencyKey,
        }),
    }),
    deletePeopleSegment: t.field({
      type: Outcome,
      description: 'Delete a segment you saved.',
      args: { id: t.arg.id({ required: true }), idempotencyKey: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) => {
        await viaRest(ctx, 'DELETE', `/v1/segments/${encodeURIComponent(args.id)}`, {
          key: args.idempotencyKey,
        });
        return done();
      },
    }),
    requestFullValues: t.field({
      type: FullValues,
      description: 'Finance asks for sealed fields in full, with a reason; HR decides.',
      args: {
        fields: t.arg.stringList({ required: true }),
        reason: t.arg.string({ required: true }),
        asOf: t.arg.string(),
        personIds: t.arg.idList(),
        filter: t.arg.string(),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: (_root, { idempotencyKey, ...asked }, ctx) =>
        viaRest<FullValuesAnswer>(ctx, 'POST', '/v1/exports/full-values', {
          body: sent(asked),
          key: idempotencyKey,
        }),
    }),
    decideFullValues: t.field({
      type: FullValues,
      description: 'HR approves or rejects; a retry answers the request as it now stands.',
      args: {
        id: t.arg.id({ required: true }),
        approve: t.arg.boolean({ required: true }),
        note: t.arg.string(),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: (_root, { id, idempotencyKey, ...decision }, ctx) =>
        viaRest<FullValuesAnswer>(
          ctx,
          'POST',
          `/v1/exports/full-values/${encodeURIComponent(id)}/decision`,
          { body: sent(decision), key: idempotencyKey },
        ),
    }),
  }));

  builder.queryFields((t) => ({
    peopleIdentifierReviews: t.field({
      type: ReviewsRef,
      description: 'Doubted national identifiers waiting for HR (PEO-125); HR only.',
      resolve: view<IdentifierReviewsView>(() => '/v1/views/identifier-reviews'),
    }),
    peopleIdentifierCheck: t.field({
      type: FindingsRef,
      description:
        'What saving these values would be warned about; nothing is kept. No person id is "my record".',
      args: {
        personId: t.arg.id(),
        changed: t.arg({ type: [FormValueInput], required: true }),
      },
      resolve: (_root, args, ctx) =>
        viaRest<{ findings: IdentifierFindingView[] }>(
          ctx,
          'POST',
          args.personId
            ? `/v1/views/people/${encodeURIComponent(args.personId)}/identifier-check`
            : '/v1/views/me/identifier-check',
          { body: { changed: changed(args.changed) } },
        ),
    }),
    peoplePublishPreview: t.field({
      type: PreviewRef,
      description: 'What publishing the draft would do, from requiredFrom; rolled back.',
      args: { requiredFrom: t.arg.string({ required: true }) },
      resolve: (_root, args, ctx) =>
        viaRest<Preview>(ctx, 'POST', '/v1/schema/draft/preview', {
          body: { requiredFrom: args.requiredFrom },
        }),
    }),
    peopleClassificationAdvice: t.field({
      type: AdviceRef,
      args: {
        label: t.arg.string({ required: true }),
        description: t.arg.string(),
        dataType: t.arg.string({ required: true }),
        sectionKey: t.arg.string({ required: true }),
        options: t.arg.stringList({ required: true }),
      },
      resolve: (_root, args, ctx) =>
        viaRest<Advice>(ctx, 'POST', '/v1/schema/draft/advice', {
          body: { ...args, description: args.description ?? null },
        }),
    }),
  }));
}

/** Only the arguments a caller actually sent: REST's optional fields are absent, never null. */
function sent(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, v]) => v !== null && v !== undefined));
}
