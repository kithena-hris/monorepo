import * as z from 'zod';
import { CompanyScale, DEFAULT_SCALE } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { DEFAULT_FEEDBACK, type FeedbackSettings } from '../domain/feedback.js';
import type { Period } from '../domain/goals.js';
import { adminOnly, audit, type Ctx } from './context.js';

/**
 * Settings › Performance (PRD §21, design S1–S10): one JSON value per
 * section, each with its defaults, so a company that never opened settings
 * still has a working module.
 */

export const AI_FEATURES = [
  'builder',
  'summaries',
  'sentiment',
  'prefill',
  'writingChecks',
  'toneCheck',
  'setupByChat',
  'automationsInWords',
  'charts',
  'learningSuggestions',
  'calibrationSuggestions',
  'panel',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const EVIDENCE_SOURCES = [
  'slack',
  'teams',
  'gchat',
  'meet',
  'github',
  'gitlab',
  'linear',
  'jira',
  'confluence',
] as const;

const General = z.object({
  scale: CompanyScale,
  decimals: z.union([z.literal(1), z.literal(2)]),
  zone: z.string().min(1).max(60),
  parts: z.object({
    goals: z.boolean(),
    learning: z.boolean(),
    calibration: z.boolean(),
    automations: z.boolean(),
  }),
});
const Reviews = z.object({
  release: z.enum(['manager', 'hr_date', 'close']),
  minimum: z.int().min(1).max(20),
  perReviewer: z.int().min(1).max(50),
  workload: z.int().min(1).max(100),
  acknowledge: z.boolean(),
  subjectComment: z.boolean(),
  templates: z.record(z.string(), z.uuid().nullable()),
});
const Feedback = z.object({
  who: z.enum(['anyone', 'team', 'nobody']),
  sees: z.enum(['recipient', 'recipient_manager', 'recipient_manager_hr']),
  names: z.enum(['never', 'always', 'writer']),
  praise: z.object({
    public: z.boolean(),
    chat: z.boolean(),
    values: z.array(z.string().min(1).max(40)).max(20),
  }),
  toneCheck: z.boolean(),
  templates: z.boolean(),
});
const Goals = z.object({
  periods: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        name: z.string().min(1).max(60),
        from: z.iso.date(),
        to: z.iso.date(),
        cadence: z.enum(['weekly', 'fortnightly', 'monthly', 'none']),
      }),
    )
    .max(40),
  weighted: z.boolean(),
  rollUp: z.boolean(),
  follow: z.boolean(),
});
const Learning = z.object({
  providers: z
    .array(z.object({ name: z.string().max(60), connected: z.boolean(), items: z.int().min(0) }))
    .max(10),
  certificatesYears: z.int().min(0).max(20),
  attendanceShare: z.int().min(1).max(100),
});
const Calibration = z.object({
  potentialQuestionId: z.string().max(40).nullable(),
  guide: z.record(z.string(), z.int().min(0).max(100)),
  managersOwnOnly: z.boolean(),
  peerNames: z.boolean(),
});
const Ai = z.object({ features: z.record(z.string(), z.boolean()) });
const Integrations = z.object({
  connections: z.record(z.string(), z.boolean()),
  evidence: z.record(z.string(), z.boolean()),
  webhooks: z.array(z.url()).max(10),
});
const Privacy = z.object({
  retention: z.object({
    reviewsYears: z.int().min(1).max(30),
    feedbackYears: z.int().min(1).max(30),
    notesYears: z.int().min(1).max(30),
    learningYears: z.int().min(1).max(30),
    aiYears: z.int().min(1).max(30),
  }),
  holds: z
    .array(z.object({ personId: z.uuid(), reason: z.string().max(300), at: z.string() }))
    .max(100),
  worksCouncil: z.record(z.string(), z.object({ agreed: z.string().nullable(), on: z.boolean() })),
});
const Roles = z.object({ hr: z.array(z.uuid()).max(100) });

export const SECTIONS = {
  general: General,
  reviews: Reviews,
  feedback: Feedback,
  goals: Goals,
  learning: Learning,
  calibration: Calibration,
  ai: Ai,
  integrations: Integrations,
  privacy: Privacy,
  roles: Roles,
} as const;
export type Section = keyof typeof SECTIONS;

export interface Settings {
  readonly general: z.infer<typeof General>;
  readonly reviews: z.infer<typeof Reviews>;
  readonly feedback: FeedbackSettings;
  readonly goals: z.infer<typeof Goals> & { readonly periods: readonly Period[] };
  readonly learning: z.infer<typeof Learning>;
  readonly calibration: z.infer<typeof Calibration>;
  readonly ai: z.infer<typeof Ai>;
  readonly integrations: z.infer<typeof Integrations>;
  readonly privacy: z.infer<typeof Privacy>;
  readonly roles: z.infer<typeof Roles>;
}

const year = (offset = 0) => String(new Date().getUTCFullYear() + offset);

export const DEFAULTS = (): Settings => ({
  general: {
    scale: DEFAULT_SCALE,
    decimals: 1,
    zone: 'Europe/Madrid',
    parts: { goals: true, learning: true, calibration: true, automations: true },
  },
  reviews: {
    release: 'manager',
    minimum: 3,
    perReviewer: 5,
    workload: 12,
    acknowledge: true,
    subjectComment: true,
    templates: {},
  },
  feedback: DEFAULT_FEEDBACK,
  goals: {
    periods: [
      {
        id: `h1-${year()}`,
        name: `H1 ${year()}`,
        from: `${year()}-01-01`,
        to: `${year()}-06-30`,
        cadence: 'fortnightly',
      },
      {
        id: `h2-${year()}`,
        name: `H2 ${year()}`,
        from: `${year()}-07-01`,
        to: `${year()}-12-31`,
        cadence: 'fortnightly',
      },
      {
        id: `y-${year()}`,
        name: year(),
        from: `${year()}-01-01`,
        to: `${year()}-12-31`,
        cadence: 'monthly',
      },
      {
        id: `h1-${year(1)}`,
        name: `H1 ${year(1)}`,
        from: `${year(1)}-01-01`,
        to: `${year(1)}-06-30`,
        cadence: 'fortnightly',
      },
    ] as Period[],
    weighted: true,
    rollUp: false,
    follow: true,
  },
  learning: {
    providers: [
      { name: 'LinkedIn Learning', connected: false, items: 0 },
      { name: 'Udemy Business', connected: false, items: 0 },
      { name: 'Pluralsight', connected: false, items: 0 },
    ],
    certificatesYears: 3,
    attendanceShare: 75,
  },
  calibration: {
    potentialQuestionId: null,
    guide: {
      star: 10,
      high: 15,
      corePotential: 15,
      core: 35,
      effective: 5,
      trusted: 0,
      inconsistent: 10,
      lowPotential: 5,
      under: 5,
    },
    managersOwnOnly: true,
    peerNames: false,
  },
  // Every feature on by default (PRD §22.6, the owner's decision of 17 Oct 2026).
  ai: { features: Object.fromEntries(AI_FEATURES.map((f) => [f, true])) },
  integrations: {
    connections: { google: false, microsoft: false, slack: false, teams: false, gchat: false },
    evidence: Object.fromEntries(EVIDENCE_SOURCES.map((s) => [s, true])),
    webhooks: [],
  },
  privacy: {
    retention: { reviewsYears: 6, feedbackYears: 3, notesYears: 2, learningYears: 3, aiYears: 2 },
    holds: [],
    worksCouncil: {},
  },
  roles: { hr: [] },
});

/** Every section, stored over its default; a section never saved is its default. */
export async function settingsOf(ctx: Ctx): Promise<Settings> {
  const base = DEFAULTS();
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(SECTIONS) as Section[]) {
    const kept = await ctx.tx.settings.get(key);
    if (kept !== null && typeof kept === 'object') out[key] = { ...base[key], ...kept };
  }
  return out as unknown as Settings;
}

/** One section saved whole, checked against its schema; only an administrator. */
export async function saveSection(
  ctx: Ctx,
  section: string,
  value: unknown,
): Promise<Result<{ ok: true }>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  if (!(section in SECTIONS)) return err(failure('BAD_REQUEST', `No settings section ${section}`));
  const schema = SECTIONS[section as Section];
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    return err(
      failure(
        'BAD_REQUEST',
        parsed.error.issues[0]?.message ?? 'Invalid settings',
        parsed.error.issues[0]?.path.map(String),
      ),
    );
  await ctx.tx.settings.set(section, parsed.data);
  await audit(ctx, { kind: 'setting',
    action: 'Changed settings',
    target: `Settings › ${section}`,
    fields: Object.keys(parsed.data),
  });
  return ok({ ok: true });
}

export async function aiOn(ctx: Ctx, feature: AiFeature): Promise<boolean> {
  return ctx.deps.model !== undefined && (await settingsOf(ctx)).ai.features[feature] !== false;
}
