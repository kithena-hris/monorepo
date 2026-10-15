import type { Frame } from './frame';
import type { Loadable } from './load';

/**
 * What the shell hands every Onboarding screen (ONB-010), and the read models
 * Onboarding answers with (`services/onboarding/src/application/screens.ts`),
 * as the remote reads them. Plain data: a remote never imports a contract.
 */

export type Done =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly message: string; readonly code?: string };

export interface ScreenProps<T> {
  readonly load: Loadable<T>;
  readonly onNavigate?: (to: string) => void;
  readonly onFilter?: (patch: Readonly<Record<string, string | null>>) => void;
  readonly onAct?: (name: string, variables: Readonly<Record<string, unknown>>) => Promise<Done>;
  readonly onRefresh?: () => void;
  readonly frame?: Frame;
  readonly path?: string;
  readonly params?: Readonly<Record<string, string>>;
  readonly search?: Readonly<Record<string, string>>;
}

export type PlanState = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type OwnerRole = 'new_hire' | 'manager' | 'buddy' | 'hr' | 'it' | 'person';
export type Phase = 'before_start' | 'day_one' | 'first_week' | 'first_month' | 'probation';
export type TaskKind =
  'todo' | 'form' | 'document' | 'acknowledge' | 'meeting' | 'equipment' | 'account';

export interface BoardData {
  readonly rows: readonly {
    readonly id: string;
    readonly name: string;
    readonly state: PlanState;
    readonly startDate: string;
    readonly department: string | null;
    readonly country: string;
    readonly manager: string | null;
    readonly done: number;
    readonly total: number;
    readonly late: number;
    readonly next: { readonly title: string; readonly dueOn: string } | null;
  }[];
  readonly hr: boolean;
}

export interface PlanData {
  readonly plan: {
    readonly id: string;
    readonly name: string;
    readonly state: PlanState;
    readonly startDate: string;
    readonly probationEnd: string | null;
    readonly department: string | null;
    readonly location: string | null;
    readonly country: string;
    readonly workMode: string;
    readonly managerId: string | null;
    readonly buddyId: string | null;
    readonly personId: string | null;
    readonly allowedExtensionMonths: number | null;
  };
  readonly manager: string | null;
  readonly buddy: string | null;
  readonly progress: { readonly done: number; readonly total: number; readonly late: number };
  readonly tasks: readonly {
    readonly id: string;
    readonly key: string;
    readonly title: string;
    readonly phase: Phase;
    readonly ownerRole: OwnerRole;
    readonly kind: TaskKind;
    readonly dueOn: string;
    readonly due: string;
    readonly state: 'open' | 'done';
    readonly doneAt: string | null;
    readonly locked: boolean;
    readonly link: string | null;
    readonly late: boolean;
    readonly mine: boolean;
  }[];
  readonly checkIns: readonly {
    readonly day: number;
    readonly by: string;
    readonly notes: string;
    readonly at: string;
  }[];
  readonly reviews: readonly {
    readonly outcome: string;
    readonly probationEnd: string | null;
    readonly by: string;
    readonly at: string;
  }[];
  readonly members: readonly { readonly personId: string; readonly name: string }[];
  readonly may: {
    readonly setBuddy: boolean;
    readonly moveStart: boolean;
    readonly review: boolean;
    readonly checkIn: boolean;
  };
}

export interface TasksData {
  readonly rows: readonly {
    readonly planId: string;
    readonly taskId: string;
    readonly name: string;
    readonly title: string;
    readonly kind: TaskKind;
    readonly ownerRole: OwnerRole;
    readonly dueOn: string;
    readonly late: boolean;
    readonly link: string | null;
  }[];
}

export interface TemplateTask {
  readonly key: string;
  readonly title: string;
  readonly phase: Phase;
  readonly ownerRole: OwnerRole;
  readonly ownerPersonId: string | null;
  readonly kind: TaskKind;
  readonly due: string;
  readonly link: string | null;
}

export interface TemplatesData {
  readonly templates: readonly {
    readonly id: string;
    readonly name: string;
    readonly active: boolean;
    readonly conditions: {
      readonly countries?: readonly string[];
      readonly departments?: readonly string[];
      readonly workModes?: readonly string[];
      readonly contractTypes?: readonly string[];
      readonly legalEntityIds?: readonly string[];
    };
    readonly tasks: readonly TemplateTask[];
  }[];
}

export interface SettingsData {
  readonly roles: { readonly hr: readonly string[]; readonly it: readonly string[] };
  readonly holidays: Readonly<Record<string, readonly string[]>>;
  readonly defaultCountry: string;
  readonly members: readonly { readonly personId: string; readonly name: string }[];
}

export interface AnalyticsData {
  readonly inFlight: number;
  readonly completed: number;
  readonly onTrack: number;
  readonly lateByRole: readonly { readonly role: string; readonly count: number }[];
  readonly probation: readonly { readonly outcome: string; readonly count: number }[];
}
