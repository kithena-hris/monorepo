import { useToast } from '@reach/ui-native';
import { useCallback, useState } from 'react';

import { ask, useSigned, wrote } from './api';

/**
 * A write, from a button: asked of People, its refusal said in a toast in
 * People's own words, its success in the words the caller gives. `busy` is
 * which one is running, so only its button spins.
 */
export function useAct(area: 'people' | 'timeoff' = 'people'): {
  act: <T>(
    operation: string,
    variables: Record<string, unknown>,
    done?: string | ((data: T) => string | null),
  ) => Promise<T | null>;
  busy: string | null;
} {
  const signed = useSigned();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const act = useCallback(
    async <T>(
      operation: string,
      variables: Record<string, unknown>,
      done?: string | ((data: T) => string | null),
    ): Promise<T | null> => {
      setBusy(operation);
      const answer = await ask<T>(signed, operation, variables, area);
      setBusy(null);
      wrote();
      if (!answer.ok) {
        toast({ title: 'That did not work', description: answer.message, tone: 'danger' });
        return null;
      }
      const said = typeof done === 'function' ? done(answer.data) : done;
      if (said !== undefined && said !== null) toast({ title: said, tone: 'success' });
      return answer.data;
    },
    [signed, toast, area],
  );
  return { act, busy };
}
