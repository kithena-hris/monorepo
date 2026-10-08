import type { NativeStackScreenProps } from '@react-navigation/native-stack';

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
  Directory: { search?: string } | undefined;
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
};

export type PeopleScreen<K extends keyof PeopleRoutes> = NativeStackScreenProps<PeopleRoutes, K>;
