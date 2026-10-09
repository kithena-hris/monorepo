import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { Condition } from './filters';

/**
 * The People tab's screens, pushed on its own stack so the tab bar stays and
 * Back (and the edge swipe) returns where you were. The Me tab's stack holds a
 * `Profile` too: yours.
 */
export type PeopleRoutes = {
  /** The Home tab: the person's own To do, or HR's figures and Needs HR (design B1, B2). */
  Home: undefined;
  People: undefined;
  /** The Inbox tab: what waits for this person, flagged changes, and being viewed as (B3). */
  Inbox: undefined;
  /** A new starter's sections, one at a time (D7). */
  Onboarding: undefined;
  /** `conditions`: opened on these, as a point in What changed links to its records. */
  Directory: { search?: string; conditions?: readonly Condition[] } | undefined;
  OrgChart: undefined;
  /** `personId` absent: the viewer's own record. `back` is what the bar's back says. */
  Profile: { personId?: string; name?: string; back?: string } | undefined;
  /** One section of a record, editable: `personId` absent is the viewer's own. */
  EditSection: { personId?: string; sectionKey: string; back: string };
  /** A record's changes, newest first, and the record as of a date. */
  History: { personId?: string; back: string };
  /** Every decision and missing detail, in one queue (design E1). */
  Review: { kind?: string } | undefined;
  /** One change to decide, answer or withdraw (E2, E6). */
  ReviewChange: { id: string };
  /** One identifier the checks doubt (E3). */
  ReviewId: { personId: string; attributeKey: string };
  /** Two records that may be one person (E4). */
  ReviewDuplicate: { a: string; b: string };
  /** A request for full values (E7). */
  ReviewAccess: { id: string };
  /** A request to send an export to somebody who cannot see all of it. */
  ReviewShare: { id: string };
  /** Two tiles and the history (design F1). */
  ImportExport: undefined;
  /** A file, its columns, new fields, the plan (F2–F4). */
  Import: undefined;
  /** An approved import, followed until it is done (F5). */
  ImportRun: { id: string };
  /** Who, which fields, as of when, and download, send or schedule (F6, F7). */
  Export: { sentence?: string } | undefined;
  /** One export: what is in it, who has it, the download. */
  ExportRecord: { id: string };
  /** The people chosen in the Directory: the same values from a date, or hired (the web's bulk edit). */
  /** The Time off tab: today's clock, balances, a suggestion, what is coming up (MT1). */
  TimeOff: undefined;
  /** Where a balance's days went (MT20). */
  TimeOffBalance: { leaveTypeKey: string; name: string };
  /** The holidays where the person works, this year and next (MT21). */
  TimeOffHolidays: undefined;
  /** Asking for time off: the type, the dates, the review (MT5–MT9). */
  TimeOffRequest:
    { leaveTypeKey?: string; from?: string; to?: string; sentence?: string } | undefined;
  /** The person's own requests: coming up, past, cancelled. */
  TimeOffRequests: undefined;
  /** One request: where it is, what happens next, and changing or cancelling it (MT10). */
  TimeOffRequestDetail: { requestId: string };
  /** A sentence, read into choices, and the best dates for it (MT8). */
  TimeOffDescribe: { sentence?: string } | undefined;
  /** Parental leave: the person's plan, a step at a time (MT11, MT12). */
  TimeOffParental: undefined;
  /** Who's off: the team's week, a month or the year (MT13, MT14). */
  TimeOffCalendar: undefined;
  /** Requests waiting for this approver, coming up and decided (MT15). */
  TimeOffApprovals: undefined;
  /** One request to decide, on the go (MT16). */
  TimeOffDecision: { requestId: string; name: string };
  /** Who approves while this approver is away. */
  TimeOffDelegation: undefined;
  /** The person's week, worked against planned, and fixing a missed clock-out (MT17, MT18). */
  TimeOffTimesheet: undefined;
  /** A manager's team right now (MT19). */
  TimeOffTeamNow: undefined;
  /** Overtime to decide, late corrections, and your own overtime. */
  TimeOffAttendanceRequests: undefined;
  /** HR's attendance exceptions, a month at a time. */
  TimeOffExceptions: undefined;
  /** HR's pay period: what goes to payroll, reminders, closing it. */
  TimeOffPayPeriod: undefined;
  /** The member's kiosk QR and PIN. */
  TimeOffKioskCode: undefined;
  /** HR's parental leave plans, and one to approve. */
  TimeOffParentalCases: undefined;
  /** HR's absence insights and nudges. */
  TimeOffInsights: undefined;
  /** HR's Time Off settings: leave types, policies, approvals, attendance, holidays, integrations. */
  TimeOffSettings:
    | {
        section?:
          'leave-types' | 'negative' | 'approvals' | 'attendance' | 'holidays' | 'integrations';
      }
    | undefined;
  /** One leave type and its policies. */
  TimeOffLeaveType: { leaveTypeKey: string; name: string };
  /** A policy described in words and read back. */
  TimeOffPolicyDescribe: { leaveTypeKey: string; policyId?: string };
  TimeOffParentalCase: { planId: string; name: string };
  BulkEdit: { personIds: readonly string[] };
  /** What changed and the charts, a tab at a time (G1–G3). */
  Insights: { tab?: string } | undefined;
  /** HR's scheduled reports (G4). */
  ScheduledReports: undefined;
  /** One schedule's runs, newest first. */
  ReportHistory: { id: string; name: string };
  /** People's settings, for its administrators and HR (H1). */
  Settings: undefined;
  /** The employee fields: sections, then a section's fields, and publishing (H2, H3). */
  FieldRegistry: { section?: string } | undefined;
  /** The first administrator's setup: legal entity, country pack, version 1, their own record. */
  PeopleSetup: undefined;
  /** A published field's type or format changed: every value reviewed before it is published. */
  FieldChange: { key: string; to: string };
  /** Legal entities, locations, numbering, pay bands and the company's defaults (H7). */
  Organisation: undefined;
  /** Who holds administrator, HR and finance access (H4). */
  Roles: undefined;
  /** Chat apps, webhooks and provisioning (H5). */
  Integrations: { tab?: 'slack' | 'webhooks' | 'provisioning' } | undefined;
  /** An endpoint's deliveries, a failed one replayable. */
  WebhookLog: { id: string; url: string };
  /** Who did what, and when (H6). */
  Activity: undefined;
};

export type PeopleScreen<K extends keyof PeopleRoutes> = NativeStackScreenProps<PeopleRoutes, K>;
