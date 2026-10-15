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
  'applied' | 'screening' | 'interview' | 'assessment' | 'works_council' | 'offer' | 'hired';

export interface Stage {
  readonly id: string;
  readonly name: string;
  readonly candidateName: string | null;
  readonly category: Category;
  readonly automations: readonly unknown[];
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
    readonly html: string;
    readonly plain: string;
    readonly checks: readonly AdCheck[];
  }[];
  readonly targets: readonly Target[];
  readonly criteria: readonly {
    readonly id: string;
    readonly text: string;
    readonly must: boolean;
    readonly weight: number;
  }[];
  readonly plan: readonly {
    readonly key: string;
    readonly title: string;
    readonly minutes: number;
    readonly interviewerIds: readonly string[];
    readonly competencies: readonly string[];
    readonly scorecardTemplateId: string | null;
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
  readonly unread: number;
  readonly nextInterview: { readonly title: string; readonly startsAt: string } | null;
  readonly lastMoveId: string | null;
}

export interface PipelineData {
  readonly job: { readonly id: string; readonly title: string; readonly state: string };
  readonly stages: readonly Stage[];
  readonly cards: readonly Card[];
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
    readonly references: readonly {
      readonly id: string;
      readonly refereeName: string;
      readonly state: string;
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
}
