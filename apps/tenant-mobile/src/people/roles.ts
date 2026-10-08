import { useRead } from './api';

/** The viewer's roles in People (`Home`): what the screens offer, People still decides. */
export interface Roles {
  readonly hr: boolean;
  readonly admin: boolean;
  readonly finance: boolean;
}

const NONE: Roles = { hr: false, admin: false, finance: false };

export function useRoles(): Roles {
  const { load } = useRead<Roles>('Home');
  return load.status === 'ready' ? load.data : NONE;
}
