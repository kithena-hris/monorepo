import type { Shown } from './inbox/model';

/**
 * The window event a screen asks the assistant with: its detail is the
 * question. Apart from the assistant itself, so a screen that only asks does
 * not bring the assistant's server actions with it.
 */
export const ASK_EVENT = 'kithena:ask';

/**
 * The window event a screen opens a page over itself with: its detail is
 * `{ href, label }`. Home's modal answers it (`components/home-modal.tsx`),
 * so a task, a profile or a request is done without leaving Home.
 */
export const OPEN_EVENT = 'kithena:open';

export interface OpenDetail {
  readonly href: string;
  /** What it is, for the modal's title: "Jen Davis", "Request time off". */
  readonly label: string;
}

/** Home's tasks, whole, for the modal that opens them: sent as To do's rows arrive. */
export const HELD_EVENT = 'kithena:held';
export interface HeldDetail {
  readonly items: readonly Shown[];
  readonly now: string;
  readonly zone: string;
}
