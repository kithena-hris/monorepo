import { ask, useRead, type Answer, type Load, type Signed } from '../people/api';
import { languageHeader } from '../i18n';
import { t } from '../i18n';

/** One of Time Off's operations, as the person signed in: the same route as People's. */
export const askTimeOff = <T>(
  signed: Signed,
  operation: string,
  variables: Record<string, unknown> = {},
): Promise<Answer<T>> => ask<T>(signed, operation, variables, 'timeoff');

/** One Time Off read, kept for the screen, as `useRead` keeps People's. */
export const useTimeOff = <T>(
  operation: string,
  variables: Record<string, unknown> = {},
): { load: Load<T>; reload: () => void } => useRead<T>(operation, variables, 'timeoff');

/** A calendar feed's address, Time Off's token in it, for the calendar app to subscribe to. */
export async function calendarFeed(
  signed: Signed,
  scope: 'me' | 'team' | 'company',
): Promise<Answer<{ url: string }>> {
  const response = await fetch(`${signed.company.origin}/api/mobile/calendar-feed`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${signed.sessionId}`,
      ...languageHeader(),
    },
    body: JSON.stringify({ scope }),
  }).catch(() => null);
  if (response === null)
    return {
      ok: false,
      code: 'OFFLINE',
      message: t(
        'timeoff.api.kithena_could_not_be_reached_try',
        'Kithena could not be reached. Try again.',
      ),
    };
  if (response.status === 401) {
    signed.signedOut();
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: t('timeoff.api.sign_in_again', 'Sign in again.'),
    };
  }
  return (
    ((await response.json().catch(() => null)) as Answer<{ url: string }> | null) ?? {
      ok: false,
      code: 'UNAVAILABLE',
      message: t('timeoff.api.time_off_did_not_answer', 'Time Off did not answer.'),
    }
  );
}
