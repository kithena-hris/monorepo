import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/**
 * The People tab's screens, pushed on its own stack so the tab bar stays and
 * Back (and the edge swipe) returns where you were. The Me tab's stack holds a
 * `Profile` too: yours.
 */
export type PeopleRoutes = {
  People: undefined;
  Directory: { search?: string } | undefined;
  OrgChart: undefined;
  /** `personId` absent: the viewer's own record. `back` is what the bar's back says. */
  Profile: { personId?: string; name?: string; back?: string } | undefined;
};

export type PeopleScreen<K extends keyof PeopleRoutes> = NativeStackScreenProps<PeopleRoutes, K>;
