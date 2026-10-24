import { ask, useRead, type Answer, type Load, type Signed } from '../people/api';
import { locale } from '@reach/ui-native';

/**
 * Recruiting on the phone (REC-145): the web's operations through the
 * company's `/api/mobile/people` as `recruiting`, for hiring managers and
 * interviewers. Long forms and wide tables stay on the web (RM8).
 */

export const askRecruiting = <T>(
  signed: Signed,
  operation: string,
  variables: Record<string, unknown> = {},
): Promise<Answer<T>> => ask<T>(signed, operation, variables, 'recruiting');

export const useRecruiting = <T>(
  operation: string,
  variables: Record<string, unknown> = {},
): { load: Load<T>; reload: () => void } => useRead<T>(operation, variables, 'recruiting');

export const words = (k: string): string => {
  const s = k.replaceAll('_', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const when = (iso: string): string =>
  new Date(iso).toLocaleString(locale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
