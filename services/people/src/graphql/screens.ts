import type {
  AnalyticsView,
  ExportBuilderView,
  ImportStageView,
  IntegrationsView,
} from '../application/screens/operations.js';
import type {
  CompletenessView,
  DirectoryView,
  OnboardingView,
  ProfileView,
} from '../application/screens/people.js';
import type { FormValue, RecordField, RecordSection } from '../application/screens/model.js';
import type { RolesView } from '../application/screens/roles.js';
import type { PublishPreviewView, RegistryView, SetupView } from '../application/screens/schema.js';
import type { ColumnMapping } from '../application/import/mapping.js';
import type { ListedEndpoint } from '../infrastructure/webhooks/list.js';
import type { PeopleBuilder, RequestContext, ViaRest } from './schema.js';

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

/** Import files are capped at 100 MB (PEO-038); the router and Yoga are sized for it. */
export const IMPORT_MAX_BYTES = 100 * 1024 * 1024;

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
      items: t.stringList({ resolve: (e) => (Array.isArray(e.value) ? [...e.value] : []) }),
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

  /* --------------------------------------------------- people's screens -- */

  const Onboarding = builder.objectRef<OnboardingView>('PeopleOnboarding').implement({
    fields: (t) => ({
      firstName: t.exposeString('firstName'),
      sections: t.field({ type: [OnboardingSectionRef], resolve: (v) => list(v.sections) }),
      values: t.field({ type: [FormEntry], resolve: (v) => entries(v.values) }),
      saved: t.stringList({ resolve: (v) => list(v.saved) }),
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
  const Profile = builder.objectRef<ProfileView>('PeopleProfile').implement({
    fields: (t) => ({
      person: t.field({ type: ProfilePerson, resolve: (v) => v.person }),
      sections: t.field({ type: [ProfileSectionRef], resolve: (v) => list(v.sections) }),
      values: t.field({ type: [FormEntry], resolve: (v) => entries(v.values) }),
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
  const DirectoryRef = builder.objectRef<Directory>('PeopleDirectory').implement({
    fields: (t) => ({
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
      fields: t.field({ type: [GridField], resolve: (v) => list(v.fields) }),
      rows: t.field({ type: [GridRow], resolve: (v) => list(v.rows) }),
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
        ownership: t.stringList({ resolve: (f) => list(f.ownership) }),
        visibility: t.stringList({ resolve: (f) => list(f.visibility) }),
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
      movement: t.field({ type: Movement, nullable: true, resolve: (v) => v.movement }),
      completenessBySection: t.field({
        type: [Point],
        nullable: true,
        resolve: (v) => (v.completenessBySection === null ? null : list(v.completenessBySection)),
      }),
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
  const DryRunRef = builder.objectRef<DryRun>('ImportDryRun').implement({
    fields: (t) => ({
      counts: t.field({ type: Counts, resolve: (d) => d.counts }),
      incomplete: t.field({ type: Incomplete, resolve: (d) => d.incomplete }),
      ignoredColumns: t.stringList({ resolve: (d) => list(d.ignoredColumns) }),
      blocked: t.field({ type: [Blocked], resolve: (d) => list(d.blocked) }),
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
      blockedCsv: t.exposeString('blockedCsv', { description: 'The blocked rows, base64 CSV.' }),
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
        blockedCsv: t.exposeString('blockedCsv'),
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
            : `/v1/views/profile/${encodeURIComponent(String(args.personId))}`,
        ),
    }),
    peopleDirectory: t.field({
      type: DirectoryRef,
      args: { search: t.arg.string(), filter: t.arg.string(), after: t.arg.id() },
      resolve: (_root, args, ctx) => {
        const query = new URLSearchParams();
        if (args.search) query.set('search', args.search);
        if (args.filter) query.set('filter', args.filter);
        if (args.after) query.set('after', String(args.after));
        const qs = query.toString();
        return viaRest<DirectoryView>(ctx, 'GET', `/v1/views/directory${qs === '' ? '' : `?${qs}`}`);
      },
    }),
    peopleCompleteness: t.field({
      type: CompletenessRef,
      resolve: view<CompletenessView>(() => '/v1/views/completeness'),
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
      resolve: view<AnalyticsView>(() => '/v1/views/analytics'),
    }),
    peopleExport: t.field({
      type: ExportRef,
      description: 'The requester’s own export, its links signed again.',
      args: { id: t.arg.id({ required: true }) },
      resolve: (_root, args, ctx) =>
        viaRest<ExportAnswer>(ctx, 'GET', `/v1/exports/${encodeURIComponent(String(args.id))}`),
    }),
    fullValuesRequest: t.field({
      type: FullValues,
      args: { id: t.arg.id({ required: true }) },
      resolve: (_root, args, ctx) =>
        viaRest<FullValuesAnswer>(
          ctx,
          'GET',
          `/v1/exports/full-values/${encodeURIComponent(String(args.id))}`,
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
  const CellInput = builder.inputType('GridCellInput', {
    fields: (t) => ({ key: t.string({ required: true }), value: t.string({ required: true }) }),
  });
  const GridChange = builder.inputType('GridChangeInput', {
    fields: (t) => ({
      personId: t.id({ required: true }),
      values: t.field({ type: [CellInput], required: true }),
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
      ownership: t.stringList({ required: true }),
      collectAt: t.string({ required: true }),
      visibility: t.stringList({ required: true }),
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

  const upload = async (file: File, mapping?: readonly { column: number; key?: string | null | undefined }[]) => {
    if (file.size > IMPORT_MAX_BYTES) {
      throw new Error('An import is at most 100 MB');
    }
    return {
      name: file.name,
      file: Buffer.from(await file.arrayBuffer()).toString('base64'),
      ...(mapping === undefined
        ? {}
        : {
            mapping: Object.fromEntries(mapping.map((m) => [String(m.column), m.key ?? null])),
          }),
    };
  };

  builder.mutationFields((t) => ({
    saveOwnSection: t.field({
      type: Outcome,
      args: {
        changed: t.arg({ type: [FormValueInput], required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) => {
        await viaRest(ctx, 'POST', '/v1/views/me/sections', {
          body: { changed: changed(args.changed) },
          key: args.idempotencyKey,
        });
        return done();
      },
    }),
    savePersonSection: t.field({
      type: Outcome,
      args: {
        personId: t.arg.id({ required: true }),
        changed: t.arg({ type: [FormValueInput], required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) => {
        await viaRest(
          ctx,
          'POST',
          `/v1/views/people/${encodeURIComponent(String(args.personId))}/sections`,
          { body: { changed: changed(args.changed) }, key: args.idempotencyKey },
        );
        return done();
      },
    }),
    saveCompletenessGrid: t.field({
      type: Outcome,
      args: {
        changes: t.arg({ type: [GridChange], required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) => {
        await viaRest(ctx, 'POST', '/v1/views/completeness', {
          body: {
            changes: args.changes.map((c) => ({
              personId: String(c.personId),
              values: Object.fromEntries(c.values.map((v) => [v.key, v.value])),
            })),
          },
          key: args.idempotencyKey,
        });
        return done();
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
        await viaRest(ctx, 'PATCH', `/v1/webhooks/endpoints/${encodeURIComponent(String(id))}`, {
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
        const id = String(args.id);
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
          `/v1/webhooks/deliveries/${encodeURIComponent(String(args.deliveryId))}/replay`,
          { body: {}, key: args.idempotencyKey },
        ),
    }),
    proposeImport: t.field({
      type: ImportStage,
      description: 'Upload → the proposed mapping. Changes nothing, so takes no key.',
      args: { file: t.arg({ type: 'Upload', required: true }) },
      resolve: async (_root, args, ctx) =>
        viaRest<Stage>(ctx, 'POST', '/v1/imports/proposal', { body: await upload(args.file) }),
    }),
    dryRunImport: t.field({
      type: ImportStage,
      description: 'The five counts and the blocked rows. Changes nothing, so takes no key.',
      args: {
        file: t.arg({ type: 'Upload', required: true }),
        mapping: t.arg({ type: [ColumnInput], required: true }),
      },
      resolve: async (_root, args, ctx) =>
        viaRest<Stage>(ctx, 'POST', '/v1/imports/dry-run', {
          body: await upload(args.file, args.mapping),
        }),
    }),
    commitImport: t.field({
      type: ImportStage,
      description:
        'Import. A retry of the same key is refused ALREADY_IMPORTED: the report is not kept.',
      args: {
        file: t.arg({ type: 'Upload', required: true }),
        mapping: t.arg({ type: [ColumnInput], required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) =>
        viaRest<Stage>(ctx, 'POST', '/v1/imports', {
          body: await upload(args.file, args.mapping),
          key: args.idempotencyKey,
        }),
    }),
    requestExport: t.field({
      type: ExportRef,
      description: 'Over 2,000 rows the export is queued; ask `peopleExport` for its links.',
      args: {
        format: t.arg.string({ required: true }),
        fields: t.arg.stringList(),
        asOf: t.arg.string(),
        includeArchived: t.arg.boolean(),
        personIds: t.arg.idList(),
        filter: t.arg.string(),
        reason: t.arg.string(),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: (_root, { idempotencyKey, ...asked }, ctx) =>
        viaRest<ExportAnswer>(ctx, 'POST', '/v1/exports', {
          body: sent(asked),
          key: idempotencyKey,
        }),
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
          `/v1/exports/full-values/${encodeURIComponent(String(id))}/decision`,
          { body: sent(decision), key: idempotencyKey },
        ),
    }),
  }));

  builder.queryFields((t) => ({
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
