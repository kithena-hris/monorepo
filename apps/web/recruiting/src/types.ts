import type { Frame } from './frame';
import type { Loadable } from './load';

/**
 * What the shell hands every Recruiting screen (REC-070), and the read
 * models Recruiting answers with (`services/recruiting/src/application/
 * screens.ts`), as the remote reads them. Plain data: a remote never
 * imports a contract.
 */

export type Done =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly message: string; readonly code?: string };

export interface ScreenProps<T> {
  readonly load: Loadable<T>;
  readonly onNavigate?: (to: string) => void;
  readonly onFilter?: (patch: Readonly<Record<string, string | null>>) => void;
  /** One of Recruiting's writes, by its operation's name, with its variables. */
  readonly onAct?: (name: string, variables: Readonly<Record<string, unknown>>) => Promise<Done>;
  readonly onRefresh?: () => void;
  readonly with?: {
    readonly people: boolean;
    readonly timeoff: boolean;
    readonly documents: boolean;
  };
  readonly frame?: Frame;
  readonly path?: string;
  readonly params?: Readonly<Record<string, string>>;
  readonly search?: Readonly<Record<string, string>>;
}

export type Category =
  | 'applied'
  | 'screening'
  | 'interview'
  | 'assessment'
  | 'works_council'
  | 'offer'
  | 'contract'
  | 'hired';

export interface Stage {
  readonly id: string;
  readonly name: string;
  readonly candidateName: string | null;
  readonly category: Category;
  readonly automations: readonly unknown[];
}

/** An interview of a job, on one step of its pipeline: entering the step asks for it. */
export interface PlannedInterview {
  readonly key: string;
  readonly title: string;
  readonly minutes: number;
  readonly interviewerIds: readonly string[];
  readonly competencies: readonly string[];
  readonly scorecardTemplateId: string | null;
  readonly stageId?: string | null;
  /** `slots`: the candidate chooses from times that fit the panel; `fixed`: one time for all. */
  readonly mode?: 'slots' | 'fixed';
  readonly fixedAt?: string | null;
  readonly place?: string | null;
  readonly videoUrl?: string | null;
  readonly agenda?: string | null;
}

export interface JobCounts {
  readonly total: number;
  readonly active: number;
  readonly newThisWeek: number;
  readonly byStage: readonly {
    readonly stageId: string;
    readonly name: string;
    readonly category: Category;
    readonly count: number;
  }[];
}

/** The jobs list (`jobsScreen` in Recruiting): every job the viewer is on, archived ones too. */
export interface JobsData {
  readonly requisitionsOn: boolean;
  readonly admin: boolean;
  readonly jobs: readonly {
    readonly id: string;
    readonly title: string;
    readonly state: string;
    readonly department: string | null;
    readonly location: string | null;
    readonly openings: number;
    readonly hired: number;
    readonly counts: JobCounts;
    readonly live: readonly string[];
    readonly archivedAt: string | null;
    readonly hiringManager: { readonly personId: string; readonly name: string | null } | null;
    readonly createdAt: string;
    readonly openedAt: string | null;
    readonly may: { readonly edit: boolean; readonly archive: boolean; readonly delete: boolean };
  }[];
}

export interface HomeData {
  readonly viewer: {
    readonly personId: string | null;
    readonly admin: boolean;
    readonly name: string | null;
  };
  readonly company: string;
  readonly requisitionsOn: boolean;
  readonly tasks: readonly {
    readonly kind: string;
    readonly id: string;
    readonly title: string;
    readonly due: string | null;
  }[];
  readonly jobs: readonly {
    readonly id: string;
    readonly title: string;
    readonly state: string;
    readonly department: string | null;
    readonly openings: number;
    readonly hired: number;
    readonly counts: JobCounts;
  }[];
}

export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

export interface Requisition {
  readonly id: string;
  readonly title: string;
  readonly orgUnitId: string | null;
  readonly hiringManagerId: string | null;
  readonly hiringManager?: string | null;
  readonly legalEntityId: string | null;
  readonly locationIds: readonly string[];
  readonly openings: number;
  readonly filled: number;
  readonly targetStart: string | null;
  readonly reason: 'new_role' | 'backfill' | 'temporary_cover' | 'growth';
  readonly replacesPersonId: string | null;
  readonly budget: { readonly from: Money; readonly to: Money } | null;
  readonly justification: string;
  readonly state: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'cancelled' | 'filled';
  readonly approval?: {
    readonly step: number;
    readonly steps: number;
    readonly waitingOn: readonly (string | null)[];
    readonly changes: readonly {
      readonly field: string;
      readonly from: string;
      readonly to: string;
    }[];
    readonly mine: boolean;
  } | null;
}

export interface Target {
  readonly target: string;
  readonly state: 'pending' | 'live' | 'paused' | 'expired' | 'failed';
  readonly url: string | null;
  readonly error: string | null;
  readonly liveSince: string | null;
}

export interface AdCheck {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly source: string;
  readonly match: {
    readonly text: string;
    readonly index: number;
    readonly in: 'title' | 'body';
  } | null;
}

export interface FormField {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly required: boolean;
  readonly shown: boolean;
  readonly options?: readonly string[];
}

export interface JobRecord {
  readonly id: string;
  readonly internalTitle: string;
  readonly title: string;
  readonly requisitionIds: readonly string[];
  readonly department: string | null;
  readonly countries: readonly string[];
  readonly workMode: 'onsite' | 'hybrid' | 'remote';
  readonly salaryShown: boolean;
  readonly languages: readonly string[];
  readonly internalOnly: boolean;
  readonly confidential: boolean;
  readonly openings: number;
  readonly hired: number;
  readonly targetHireDate: string | null;
  readonly state: 'draft' | 'open' | 'on_hold' | 'closed' | 'filled';
  readonly entityId: string | null;
  readonly locationIds: readonly string[];
  readonly slug: string;
  readonly outline: {
    readonly contractType: string | null;
    readonly hours: 'full_time' | 'part_time';
    readonly seniority: string | null;
  };
  readonly salary: {
    readonly minMinor: number;
    readonly maxMinor: number;
    readonly currency: string;
    readonly period: 'year' | 'month' | 'hour';
  } | null;
  readonly searchable: boolean;
  readonly benefitIds: readonly string[];
  readonly scorecardTemplateId: string | null;
}

export interface JobData {
  readonly job: JobRecord;
  /** The company as candidates see it on the ad. */
  readonly company?: { readonly name: string; readonly logoUrl: string | null };
  readonly may: readonly string[];
  readonly team: readonly {
    readonly personId: string;
    readonly role: string;
    readonly name: string | null;
  }[];
  readonly stages: readonly Stage[];
  readonly form: {
    readonly fields: readonly FormField[];
    readonly questionnaireId: string | null;
  } | null;
  readonly ads: readonly {
    readonly language: string;
    readonly title: string;
    /** The editor's document, what a change to the words revises. */
    readonly doc?: unknown;
    readonly html: string;
    readonly plain: string;
    readonly checks: readonly AdCheck[];
  }[];
  readonly targets: readonly Target[];
  /** The ad on Kithena Jobs, before and after publishing: a preview address the team holds for a day. */
  readonly preview: string;
  /** Boards Recruiting has an adapter for here, beyond its own pages. */
  readonly boards: readonly string[];
  /** The chat channel new applicants are posted to; null when no chat app is set up. */
  readonly chat: { readonly channel: string | null } | null;
  readonly criteria: readonly {
    readonly id: string;
    readonly text: string;
    readonly must: boolean;
    readonly weight: number;
  }[];
  readonly plan: readonly PlannedInterview[];
  /** The pipelines to choose from; choosing one gives the job a copy of its steps. */
  readonly pipelines?: readonly {
    readonly id: string;
    readonly name: string;
    readonly isDefault: boolean;
    readonly stages: readonly Stage[];
  }[];
  readonly counts: JobCounts;
  readonly locations: readonly {
    readonly id: string;
    readonly name: string;
    readonly country: string;
  }[];
  readonly entities: readonly {
    readonly id: string;
    readonly name: string;
    readonly country: string;
    readonly currency: string;
  }[];
  /** The departments a job can be in: People's where present, Recruiting's own otherwise. */
  readonly orgUnits: readonly OrgUnit[];
  readonly questionnaires: readonly {
    readonly id: string;
    readonly name: string;
    readonly version: number;
  }[];
  readonly scorecards: readonly { readonly id: string; readonly name: string }[];
  readonly benefits: readonly {
    readonly id: string;
    readonly key: string;
    readonly category: string;
    readonly statutory: boolean;
    readonly names: Readonly<Record<string, string>>;
  }[];
  readonly members: readonly { readonly personId: string; readonly name: string }[];
  /** The terms, set in order: workplace, work type, contract, hours, leave, benefits. */
  readonly terms: JobTerms;
  /** What each step may offer, from the choices before it. */
  readonly options: TermsOptions;
}

export interface JobTerms {
  readonly entityId: string | null;
  readonly locationId: string | null;
  readonly workMode: 'onsite' | 'hybrid' | 'remote' | null;
  readonly hybridDaysOnsite: number | null;
  /** Hybrid: the set weekdays on site, Monday 1; null when the person chooses. */
  readonly hybridOnsiteDays: readonly number[] | null;
  readonly relationship: string | null;
  readonly contractType: string | null;
  readonly fixedTermReason: string | null;
  /** ISO weekdays, Monday 1. */
  readonly workDays: readonly number[];
  /** Minutes after midnight. */
  readonly dayStart: number | null;
  readonly dayEnd: number | null;
  readonly breakMinutes: number;
  readonly vacationDays: number | null;
  /** One figure, or a range; the figures are the job's salary. */
  readonly payKind: 'fixed' | 'range' | null;
  /** The last market estimate a model gave, to show under the pay and go back to. */
  readonly payEstimate: {
    readonly lowMinor: number;
    readonly medianMinor: number;
    readonly highMinor: number;
    readonly currency: string;
    readonly basis: string;
    readonly confidence: 'low' | 'medium' | 'high';
  } | null;
  /** The setup's page last open. */
  readonly setupStep: string | null;
  readonly benefitIds: readonly string[];
}

export interface TermsChoice {
  readonly key: string;
  readonly label: string;
  readonly unavailable?: string | null;
  /** What it means in that country, in a line. */
  readonly note?: string | null;
}

export interface TermsOptions {
  readonly country: string | null;
  readonly entities: readonly {
    readonly id: string;
    readonly name: string;
    readonly country: string;
    readonly currency: string;
    readonly fullTimeWeeklyMinutes: number;
  }[];
  readonly locations: readonly {
    readonly id: string;
    readonly name: string;
    readonly city: string | null;
    readonly country: string;
  }[];
  /** Every entity's workplaces, so a choice of entity shows its own at once. */
  readonly places: readonly {
    readonly id: string;
    readonly name: string;
    readonly city: string | null;
    readonly country: string;
    readonly entityId: string | null;
  }[];
  readonly relationships: readonly TermsChoice[];
  readonly contractTypes: readonly (TermsChoice & { readonly fixedTerm: boolean })[];
  readonly fixedTermReasons: readonly TermsChoice[];
  readonly currency: string | null;
  /** The lowest lawful yearly pay at these hours, minor units. */
  readonly minimumPayMinor: number | null;
  readonly maxWeeklyMinutes: number | null;
  readonly fullTimeWeeklyMinutes: number | null;
  readonly weeklyMinutes: number | null;
  readonly hours: 'full_time' | 'part_time' | null;
  readonly leave: {
    readonly days: number;
    readonly unit: 'working_days' | 'calendar_days';
    readonly source: string;
    readonly note: string;
  } | null;
  readonly benefits: readonly CatalogueBenefit[];
  /** Every category, built in and the company's own, with its icon. */
  readonly categories: readonly BenefitCategory[];
  readonly reviewed: boolean;
}

/** All of one country's terms the setup asks about, fetched once per country ahead of time. */
export interface TermsCatalogue {
  readonly country: string;
  readonly reviewed: boolean;
  readonly relationships: readonly TermsChoice[];
  readonly contracts: Readonly<
    Record<
      string,
      readonly (TermsChoice & { readonly fixedTerm: boolean; readonly maxWeeklyMinutes: number })[]
    >
  >;
  readonly reasons: Readonly<Record<string, readonly TermsChoice[]>>;
  /** For each kind of work, the legal leave by days worked a week, 1 to 7. */
  readonly leave: Readonly<Record<string, readonly NonNullable<TermsOptions['leave']>[]>>;
}

/** A benefit as a job picks it: its name, a line a candidate reads, and where it sits. */
export interface CatalogueBenefit {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly category: string;
  readonly statutory: boolean;
}

export interface BenefitCategory {
  readonly key: string;
  readonly name: string;
  /** An icon's name in Reach. */
  readonly icon: string;
  /** Added by the company: it can be renamed or removed. */
  readonly custom: boolean;
}

export interface Card {
  readonly applicationId: string;
  readonly candidateId: string;
  readonly name: string;
  readonly stageId: string;
  readonly outcome: 'active' | 'hired' | 'rejected' | 'withdrawn';
  readonly daysInStage: number;
  readonly flagged: boolean;
  readonly duplicate: boolean;
  readonly source: string;
  readonly appliedAt: string;
  readonly score: number | null;
  /** The evidence matrix's band, for those who may read the profile; a label, never a stage. */
  readonly match?: { readonly scoreBp: number; readonly band: 'strong' | 'good' | 'weak' } | null;
  readonly unread: number;
  readonly nextInterview: { readonly title: string; readonly startsAt: string } | null;
  /** Scorecards in, of those owed by the interviews already held. */
  readonly scorecards?: { readonly submitted: number; readonly expected: number };
  readonly lastMoveId: string | null;
}

export interface PipelineData {
  readonly job: {
    readonly id: string;
    readonly title: string;
    readonly state: string;
    /** Live on Kithena Jobs, and where it is there. */
    readonly onKithenaJobs: boolean;
    readonly publicUrl: string;
    readonly archivedAt?: string | null;
    readonly department?: string | null;
    readonly openings?: number;
    readonly hired?: number;
  };
  readonly stages: readonly Stage[];
  readonly cards: readonly Card[];
  /** The application open over the board (`?candidate=…&application=…`), read beside it. */
  readonly spotlight?: CandidateData | null;
  readonly may: readonly string[];
  readonly rejectionReasons: readonly string[];
  readonly templates: readonly {
    readonly id: string;
    readonly name: string;
    readonly purpose: string;
  }[];
  readonly pools: readonly { readonly id: string; readonly name: string }[];
}

export interface CandidateData {
  readonly candidate: {
    readonly id: string;
    readonly name: string;
    readonly email?: string;
    readonly phone?: string | null;
    readonly location?: string | null;
    readonly links?: readonly string[];
    readonly tags?: readonly string[];
    readonly createdAt?: string;
  };
  readonly files: readonly {
    readonly id: string;
    readonly kind: string;
    readonly fileName: string;
    readonly size: number;
    readonly uploadedAt: string;
  }[];
  readonly notes: readonly {
    readonly id: string;
    readonly authorId: string;
    readonly body: string;
    readonly createdAt: string;
    readonly applicationId: string | null;
  }[];
  readonly messages: readonly {
    readonly id: string;
    readonly direction: 'out' | 'in';
    readonly subject: string;
    readonly body: string;
    readonly sendAt: string;
    readonly sentAt: string | null;
    readonly createdAt: string;
  }[];
  readonly consents: readonly {
    readonly id: string;
    readonly purpose: string;
    readonly givenAt: string;
    readonly expiresOn: string | null;
    readonly withdrawnAt: string | null;
  }[];
  readonly pools: readonly {
    readonly poolId: string;
    readonly reason: string;
    readonly addedAt: string;
  }[];
  /** For the profile's own actions: a rejection's reasons and emails, and every pool to add to. */
  readonly rejectionReasons: readonly string[];
  readonly templates: readonly {
    readonly id: string;
    readonly name: string;
    readonly purpose: string;
  }[];
  readonly allPools: readonly { readonly id: string; readonly name: string }[];
  /** Interviewers and note authors by name, so the page shows people, not ids. */
  readonly names?: Readonly<Record<string, string>>;
  readonly applications: readonly {
    readonly applicationId: string;
    readonly job: { readonly id: string; readonly title: string };
    readonly stageId: string;
    readonly stages: readonly Stage[];
    readonly reached: Category;
    readonly outcome: 'active' | 'hired' | 'rejected' | 'withdrawn';
    readonly rejection: { readonly reasonKey: string; readonly at: string } | null;
    readonly source: string;
    readonly flagged: boolean;
    readonly answers: Readonly<Record<string, unknown>>;
    readonly adjustments: string | null;
    readonly history: readonly {
      readonly id: string;
      readonly from: string | null;
      readonly to: string;
      readonly at: string;
      readonly reason: string | null;
      readonly supersedes: string | null;
    }[];
    readonly interviews: readonly {
      readonly id: string;
      readonly title: string;
      readonly startsAt: string;
      readonly minutes: number;
      readonly state: string;
      readonly interviewerIds: readonly string[];
    }[];
    readonly asks: readonly Ask[];
    readonly scorecards: readonly {
      readonly interviewId: string;
      readonly interviewerId: string;
      readonly recommendation: string | null;
      readonly submittedAt: string | null;
      readonly ratings: Readonly<Record<string, number>>;
    }[];
    readonly offers: readonly {
      readonly id: string;
      readonly state: string;
      readonly version: number;
      readonly startDate: string;
      readonly baseMinor: number;
      readonly currency: string;
    }[];
    readonly prehire: {
      readonly state: string;
      readonly startDate: string;
      readonly conditions: readonly { readonly kind: string; readonly state: string }[];
    } | null;
    readonly matrix?: {
      readonly assessmentId: string;
      readonly model: string;
      readonly at: string;
      readonly scoreBp: number;
      readonly band: 'strong' | 'good' | 'weak';
      readonly findings: readonly {
        readonly criterionId: string;
        readonly criterion: string;
        readonly must: boolean;
        readonly verdict: 'met' | 'partly_met' | 'not_met' | 'not_evidenced';
        readonly passages: readonly string[];
        readonly why: string;
        readonly agreed: boolean | null;
      }[];
    } | null;
    readonly references: readonly {
      readonly id: string;
      readonly refereeName: string;
      readonly refereeEmail: string;
      readonly relationship: string | null;
      readonly state: string;
      readonly answers: Readonly<Record<string, string>> | null;
      readonly requestedAt: string | null;
      readonly completedAt: string | null;
    }[];
    readonly may: readonly string[];
  }[];
}

export interface CandidatesData {
  readonly rows: readonly {
    readonly candidateId: string;
    readonly name: string;
    readonly email: string;
    readonly tags: readonly string[];
    readonly applications: number;
    readonly latest: {
      readonly applicationId: string;
      readonly job: string;
      readonly outcome: string;
    } | null;
    readonly createdAt: string;
  }[];
  readonly q: string;
  readonly tag: string;
}

export interface PoolsData {
  readonly pools: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly count: number;
  }[];
  readonly pool: {
    readonly id?: string;
    readonly name?: string;
    readonly description?: string | null;
    readonly members: readonly {
      readonly candidateId: string;
      readonly name: string;
      readonly email: string;
      readonly reason: string;
      readonly addedAt: string;
      readonly consentUntil: string | null;
    }[];
  } | null;
  /** Open jobs a member can be put forward for. */
  readonly jobs: readonly { readonly id: string; readonly title: string }[];
}

export type Recommendation = 'strong_no' | 'no' | 'yes' | 'strong_yes';

export interface InterviewRecord {
  readonly id: string;
  readonly applicationId: string;
  readonly planKey: string;
  readonly title: string;
  readonly startsAt: string;
  readonly minutes: number;
  readonly interviewerIds: readonly string[];
  readonly state: 'scheduled' | 'completed' | 'no_show' | 'cancelled' | 'rescheduled';
  readonly place: string | null;
  readonly videoUrl: string | null;
}

type Listed = InterviewRecord & {
  readonly candidate: string;
  readonly candidateId: string | null;
  readonly job: string;
};

export interface InterviewsData {
  readonly upcoming: readonly Listed[];
  readonly owed: readonly Listed[];
}

export interface Scorecard {
  readonly interviewId: string;
  readonly interviewerId: string;
  readonly ratings: Readonly<Record<string, number>>;
  readonly recommendation: Recommendation | null;
  readonly submittedAt: string | null;
}

export interface KitData {
  readonly interview: InterviewRecord;
  readonly competencies: readonly {
    readonly key: string;
    readonly name: string;
    readonly description: string;
    readonly questions: readonly string[];
  }[];
  readonly scorecards: readonly Scorecard[];
  readonly candidate: { readonly id: string; readonly name: string };
  readonly job: { readonly id: string; readonly title: string };
  readonly names: Readonly<Record<string, string>>;
  readonly me: string;
  /** Whether the viewer books it, so may give its meeting link. */
  readonly schedules: boolean;
}

/** What the team asked of the candidate, or the candidate of the team (`asks.ts` in Recruiting). */
export interface Ask {
  readonly id: string;
  readonly applicationId: string;
  readonly kind: 'slots' | 'info' | 'change' | 'availability';
  readonly createdAt: string;
  readonly by: string | null;
  readonly planKey: string | null;
  readonly times: readonly string[];
  readonly place: string | null;
  readonly videoUrl: string | null;
  readonly agenda: { readonly html: string; readonly text: string } | null;
  /** Why it closed without an answer. */
  readonly closedBecause?: 'replaced' | 'more_times' | 'dealt_with' | null;
  readonly label: string;
  readonly detail: string | null;
  readonly interviewId: string | null;
  readonly state: 'open' | 'answered' | 'closed';
  readonly answeredAt: string | null;
  readonly answer: { readonly time: string | null; readonly text: string | null } | null;
}

export interface ScheduleData {
  readonly candidate: { readonly id: string; readonly name: string };
  readonly job: { readonly id: string; readonly title: string };
  readonly plan: JobData['plan'];
  readonly planKey: string | null;
  readonly from: string;
  readonly to: string;
  readonly slots: readonly string[];
  readonly names: Readonly<Record<string, string>>;
  readonly asks: readonly Ask[];
  readonly booked: readonly {
    readonly id: string;
    readonly title: string;
    readonly startsAt: string;
    readonly minutes: number;
    readonly place: string | null;
    readonly videoUrl: string | null;
  }[];
  /** A Meet (or Teams, or Zoom) is made at booking when nothing else is named. */
  readonly meet: boolean;
  /** The company's holidays in view, from Time Off: struck on the calendar and named. */
  readonly holidays: readonly { readonly date: string; readonly name: string }[];
  /** The interviewers' days away, kept with the link the candidate gets. */
  readonly away: Readonly<Record<string, readonly string[]>>;
  /** The interviewers' working weeks from Time Off, kept with the link too. */
  readonly weeks: Readonly<Record<string, unknown>>;
  /** Whoever is arranging it, free alongside the interviewers. */
  readonly organiser: string | null;
  /** Who runs this interview: chosen, else the plan's, else the hiring team. They are invited. */
  readonly interviewers: readonly string[];
  /** Everyone who could be chosen. */
  readonly members: readonly { readonly personId: string; readonly name: string }[];
  /** The agenda kept for this interview of this job; null until one is written. */
  readonly agenda: { readonly html: string; readonly text: string } | null;
}

export interface DebriefData {
  readonly rows: readonly {
    readonly competency: string;
    readonly average: string | null;
    readonly ratings: readonly { readonly interviewerId: string; readonly rating: number }[];
    readonly disagreement: boolean;
  }[];
  readonly recommendations: Readonly<Record<Recommendation, number>>;
  readonly submitted: number;
  readonly expected: number;
  readonly competencies: readonly { readonly key: string; readonly name: string }[];
  readonly names: Readonly<Record<string, string>>;
  readonly candidate: { readonly id: string; readonly name: string };
  readonly job: { readonly id: string; readonly title: string };
  readonly decider: boolean;
}

export interface TermLength {
  readonly count: number;
  readonly unit: 'days' | 'weeks' | 'months';
}

/** What the composer has been told so far; every field optional until its step. */
/** R19: a new offer filled from the job (`offerStart` in Recruiting), and the range its ad gave. */
export interface OfferStartData {
  readonly input: Omit<OfferVersion, 'version' | 'supersededAt'> & {
    readonly grade: string | null;
    readonly outsideBandReason: string | null;
  };
  readonly advertised: {
    readonly minMinor: number;
    readonly maxMinor: number;
    readonly currency: string;
    readonly period: 'year' | 'month' | 'hour';
  } | null;
  readonly candidate: { readonly name: string };
  readonly job: { readonly title: string };
}

export interface TermsAnswers {
  readonly region?: string | null;
  readonly relationship?: 'employee' | 'worker' | 'contractor';
  readonly contractType?: string;
  readonly fixedTermReason?: string | null;
  readonly previouslyEmployed?: boolean;
  readonly contractEnd?: string | null;
  readonly weeklyMinutes?: number | undefined;
  readonly probation?: TermLength | null;
  readonly noticeEmployee?: TermLength;
  readonly noticeEmployer?: TermLength;
  readonly workMode?: 'onsite' | 'hybrid' | 'remote';
  readonly hybridDaysOnsite?: number | null;
  readonly remoteCountry?: string | null;
  readonly agreement?: { readonly key: string; readonly group: string | null } | null;
  readonly annualPayMinor?: number | undefined;
  readonly paymentsPerYear?: number;
  readonly nonCompeteMonths?: number | null;
  readonly nonCompeteCompensationPercent?: number | null;
  readonly mobilityClause?: boolean;
}

export interface OfferVersion {
  readonly version: number;
  readonly terms: TermsAnswers;
  readonly pay: {
    readonly baseMinor: number;
    readonly currency: string;
    readonly frequency: 'year' | 'month' | 'hour';
    readonly variableTargetMinor: number;
    readonly signOnMinor: number;
    readonly relocationMinor: number;
    readonly equity: { readonly description: string; readonly units: number } | null;
  };
  readonly benefitIds: readonly string[];
  readonly startDate: string;
  readonly expiresOn: string;
  readonly letterTemplateId: string | null;
  readonly supersededAt: string | null;
}

export interface TermsIssue {
  readonly code: string;
  readonly step: string;
  readonly severity: 'error' | 'warning';
  readonly source: string;
  readonly message: string;
}

interface Choice {
  readonly key: string;
  readonly label: string;
  readonly unavailable?: string;
}

export interface OfferData {
  readonly offer: {
    readonly id: string;
    readonly applicationId: string;
    readonly state: string;
    readonly versions: readonly OfferVersion[];
    readonly acceptance: {
      readonly version: number;
      readonly at: string;
      readonly versionHash: string;
    } | null;
    readonly approvalReasons: readonly string[];
    /** Why the candidate declined, in their words; null otherwise. */
    readonly declineReason?: string | null;
  };
  readonly hash: string;
  readonly candidate: { readonly id: string; readonly name: string; readonly email: string };
  readonly signatoryPersonId: string | null;
  readonly job: { readonly id: string; readonly title: string };
  readonly meta: { readonly grade: string | null; readonly outsideBandReason: string | null };
  readonly checked: {
    readonly terms: {
      readonly contractType: string;
      readonly employmentType: string;
      readonly weeklyMinutes: number;
      readonly fte: string;
      readonly signature: 'electronic' | 'wet_ink';
      readonly documents: readonly string[];
      readonly conditions: readonly string[];
    } | null;
    readonly termsIssues: readonly TermsIssue[];
    readonly checks: readonly {
      readonly code: string;
      readonly severity: 'error' | 'approval';
      readonly message: string;
    }[];
    readonly rewards: {
      readonly baseMinor: number;
      readonly variableMinor: number;
      readonly benefitsMinor: number;
      readonly totalMinor: number;
      readonly descriptive: readonly string[];
      readonly equityUnits: number | null;
    };
    readonly packReviewed: boolean;
  } | null;
  readonly composer: {
    readonly country: string;
    readonly version: string;
    readonly reviewed: boolean;
    readonly steps: readonly {
      readonly step: string;
      readonly state: 'done' | 'open' | 'invalid' | 'skipped';
      readonly issues: readonly TermsIssue[];
    }[];
    readonly regions: readonly Choice[];
    readonly relationships: readonly Choice[];
    readonly contractTypes: readonly Choice[];
    readonly reasons: readonly Choice[];
    readonly rules: readonly {
      readonly step: string;
      readonly text: string;
      readonly source: string;
    }[];
    readonly asksPreviousEmployment: boolean;
    readonly paymentsPerYear: readonly number[];
  } | null;
  readonly approval: {
    readonly steps: readonly (readonly string[])[];
    readonly state: {
      readonly outcome: string;
      readonly waitingOn: readonly string[];
      readonly step: number;
    };
    readonly mine: boolean;
  } | null;
  readonly contract: {
    readonly route: 'documents' | 'wet_ink' | 'upload';
    readonly state: 'generated' | 'out_for_signature' | 'signed' | 'voided';
    readonly documents: readonly string[];
    readonly packVersion: string;
    readonly signedOn: string | null;
  } | null;
  readonly prehire: {
    readonly state: 'conditions_open' | 'conditions_met' | 'started' | 'cancelled';
    readonly startDate: string;
    readonly conditions: readonly { readonly kind: string; readonly state: string }[];
  } | null;
  readonly benefits: readonly {
    readonly id: string;
    readonly key: string;
    readonly category: string;
    readonly statutory: boolean;
    readonly names: Readonly<Record<string, string>>;
  }[];
  readonly bands: readonly {
    readonly grade: string;
    readonly minMinor: number;
    readonly maxMinor: number;
    readonly currency: string;
  }[];
}

export interface OffersData {
  readonly rows: readonly {
    readonly id: string;
    readonly state: string;
    readonly candidate: string;
    readonly job: string;
    readonly startDate: string;
    readonly expiresOn: string;
    readonly baseMinor: number;
    readonly currency: string;
    readonly needsMe: boolean;
  }[];
}

export interface Bucket {
  readonly key: string;
  readonly value: number | null;
  readonly n: number;
  readonly suppressed: boolean;
}

export interface AnalyticsData {
  readonly overview: {
    readonly openJobs: number;
    readonly applications: number;
    readonly hires: number;
    readonly offersOut: number;
    readonly funnel: readonly {
      readonly category: Category;
      readonly count: number;
      readonly ofPrevious: string | null;
    }[];
    readonly hiresByMonth: readonly { readonly month: string; readonly hires: number }[];
    readonly timeToHire: { readonly median: number | null; readonly p85: number | null };
    readonly sources: readonly Bucket[];
    readonly rejectionReasons: readonly Bucket[];
  };
  readonly speed: readonly {
    readonly jobId: string;
    readonly title: string;
    readonly days: number | null;
  }[];
  readonly timeInStage: readonly { readonly category: Category; readonly median: number | null }[];
  readonly offers: {
    readonly sent: number;
    readonly accepted: number;
    readonly declined: number;
    readonly rate: string | null;
  };
  readonly filters: {
    readonly period: string;
    readonly jobId?: string;
    readonly department?: string;
    readonly source?: string;
  };
}

export interface GeneralSettings {
  readonly requisitionsOn: boolean;
  readonly revealInternalAt: 'screening' | 'interview' | 'assessment' | 'offer';
  readonly replyAddress: string | null;
  readonly federalContractor: boolean;
  readonly rejectionReasons: readonly string[];
  readonly referralBonus: {
    readonly amountMinor: number;
    readonly currency: string;
    readonly after: 'probation' | 'three_months' | 'six_months';
  } | null;
  readonly companyName: string;
  readonly companySlug: string;
  readonly about: string | null;
  readonly themeId: string;
  readonly logoUrl: string | null;
  readonly searchable: boolean;
  readonly ai: {
    readonly parser: boolean;
    readonly matrix: boolean;
    readonly writer: boolean;
    readonly assistant: boolean;
    readonly charts: boolean;
    readonly nycAuditOn: string | null;
    readonly maskSchools?: boolean;
  };
  readonly selfId?: { readonly gender: boolean; readonly ethnicity: boolean };
}

export interface Agency {
  readonly id: string;
  readonly name: string;
  readonly contactEmail: string;
  readonly fee:
    | { readonly kind: 'percent'; readonly basisPoints: number }
    | { readonly kind: 'fixed'; readonly amountMinor: number };
  readonly guaranteeDays: number;
  readonly ownershipMonths: number;
  readonly active: boolean;
  readonly jobIds: readonly string[];
}

/** Where a legal entity, a location or a department came from: People, or here. */
export type OrgSource = 'recruiting' | 'people';

export interface SettingsEntity {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly currency: string;
  readonly fullTimeWeeklyMinutes: number;
  readonly headcount: number;
  readonly foundedOn: string | null;
  readonly worksCouncil: boolean;
  readonly worksCouncilIds: readonly string[];
  readonly source?: OrgSource;
}

export interface SettingsLocation {
  readonly id: string;
  readonly name: string;
  readonly entityId: string | null;
  readonly country: string;
  readonly region: string | null;
  readonly city: string | null;
  readonly timeZone: string;
  readonly source?: OrgSource;
}

export interface OrgUnit {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly source?: OrgSource;
}

export type Approver =
  | { readonly kind: 'person'; readonly personId: string }
  | { readonly kind: 'role'; readonly role: 'hr' | 'finance' | 'recruiting_admin' }
  | { readonly kind: 'managers_manager' };

export interface ApprovalChain {
  readonly id: string;
  readonly name: string;
  readonly appliesTo: 'requisition' | 'offer';
  readonly priority: number;
  readonly when: {
    readonly budgetAboveMinor?: number;
    readonly reasons?: readonly string[];
    readonly legalEntityIds?: readonly string[];
    readonly outsideBand?: boolean;
    readonly aboveBudget?: boolean;
    readonly grades?: readonly string[];
  };
  readonly steps: readonly Approver[];
}

export type QuestionKind =
  'short_text' | 'long_text' | 'single' | 'multiple' | 'number' | 'yes_no' | 'date' | 'file';

export interface Question {
  readonly id: string;
  readonly text: string;
  readonly kind: QuestionKind;
  readonly required: boolean;
  readonly options: readonly string[];
  readonly points: Readonly<Record<string, number>> | null;
  readonly knockout: Knockout | null;
}

/** A knockout rule a person wrote (PRD §15): by default it flags the application for review. */
export interface Knockout {
  /** The answers that knock out: options, or "yes"/"no". */
  readonly answers: readonly string[];
  /** For a number: below this knocks out. */
  readonly below?: number;
  readonly autoReject: boolean;
  /** The question asks a legal requirement for the job: the only case a German or Spanish job may auto-reject. */
  readonly legalRequirement: boolean;
}

export interface Questionnaire {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly questions: readonly Question[];
  readonly worksCouncilConsentVersion: number | null;
}

export interface MessageTemplate {
  readonly id: string;
  readonly kind: 'email' | 'offer_letter' | 'contract';
  readonly purpose: string;
  readonly language: string;
  readonly name: string;
  readonly subject: string | null;
  readonly body: string;
}

export type BenefitValue =
  | { readonly kind: 'money'; readonly yearlyMinor: number; readonly currency: string }
  | { readonly kind: 'percent'; readonly basisPoints: number }
  | { readonly kind: 'days'; readonly days: number }
  | { readonly kind: 'descriptive' };

export interface Benefit {
  readonly id: string;
  readonly key: string;
  readonly legalEntityId: string;
  readonly category: string;
  readonly statutory: boolean;
  readonly names: Readonly<Record<string, string>>;
  readonly description?: string | null;
  readonly value: BenefitValue;
  readonly eligibility: {
    readonly employmentTypes: readonly string[] | null;
    readonly minWeeklyMinutes: number | null;
    readonly waiting:
      | { readonly kind: 'none' }
      | { readonly kind: 'after_probation' }
      | { readonly kind: 'months'; readonly months: number };
    readonly workModes: readonly string[] | null;
    readonly locationIds: readonly string[] | null;
  };
  readonly taxNote: string | null;
}

export interface SettingsData {
  readonly general: GeneralSettings;
  readonly entities: readonly SettingsEntity[];
  readonly locations: readonly SettingsLocation[];
  /** The departments: People's where present, Recruiting's own otherwise or beside them. */
  readonly orgUnits: readonly OrgUnit[];
  /** Names to pick for an approval chain's "person" step. */
  readonly members: readonly { readonly personId: string; readonly name: string }[];
  readonly pipelines: readonly {
    readonly id: string;
    readonly name: string;
    readonly isDefault: boolean;
    readonly stages: readonly Stage[];
  }[];
  readonly chains: readonly ApprovalChain[];
  readonly questionnaires: readonly Questionnaire[];
  readonly scorecards: readonly {
    readonly id: string;
    readonly name: string;
    readonly competencies: readonly {
      readonly key: string;
      readonly name: string;
      readonly description?: string;
      readonly questions?: readonly string[];
    }[];
  }[];
  readonly templates: readonly MessageTemplate[];
  /** The words each standard email sends until the company writes its own. */
  readonly builtInEmails?: readonly {
    readonly purpose: string;
    readonly name: string;
    readonly subject: string;
    readonly body: string;
  }[];
  /** Each entity's full catalogue, the standard library included. */
  readonly benefits: readonly Benefit[];
  readonly benefitCategories: readonly BenefitCategory[];
  /** The icons a category may wear, by name in Reach. */
  readonly categoryIcons: readonly string[];
  readonly payBands: readonly {
    readonly id: string;
    readonly grade: string;
    readonly minMinor: number;
    readonly maxMinor: number;
    readonly currency: string;
    readonly source: 'recruiting' | 'people';
  }[];
  readonly agencies: readonly Agency[];
  /** The careers page on the company's own domain (REC-136). */
  readonly careersDomain: CareersDomain | null;
  /** Whether Kithena Jobs can take a domain of a company's own here at all. */
  readonly domainsOn: boolean;
  readonly jobs: readonly { readonly id: string; readonly title: string }[];
  readonly admin: boolean;
  /** The company as the rest of Kithena knows it: what the careers page starts from. */
  readonly company?: {
    readonly name: string | null;
    readonly slug: string;
    readonly logoUrl: string | null;
    readonly themeId: string | null;
  };
}

export interface CareersDomain {
  readonly host: string;
  readonly status: 'pending' | 'verified';
  /** What the company's DNS needs, as the hosting answered it. */
  readonly records: readonly {
    readonly type: string;
    readonly name: string;
    readonly value: string;
  }[];
  readonly verifiedAt: string | null;
}

export interface BoardData {
  readonly jobs: readonly {
    readonly id: string;
    readonly title: string;
    readonly department: string | null;
    readonly workMode: string;
    readonly slug: string;
  }[];
  readonly referrals: readonly {
    readonly id: string;
    readonly name: string;
    readonly job: string;
    readonly at: string;
    readonly outcome: string;
  }[];
  readonly bonus: GeneralSettings['referralBonus'];
}
