import type { Frame } from './frame';
import type { Loadable } from './load';

/**
 * What the shell hands every Performance screen (PRF-070), as Onboarding's
 * remote has it. Plain data: a remote never imports a contract, so each
 * screen describes the part of Performance's answer it draws.
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

export type CycleState =
  | 'draft'
  | 'scheduling'
  | 'scheduled'
  | 'launching'
  | 'launch_failed'
  | 'in_progress'
  | 'closing'
  | 'closed'
  | 'archived';

export type Kind = 'self' | 'manager' | 'peer' | 'upward' | 'skip' | 'goals';

export interface ScaleOption {
  readonly label: string;
  readonly description: string | null;
  readonly value: number;
}

interface QuestionBase {
  readonly id: string;
  readonly prompt: string;
  readonly help: string | null;
  readonly required: boolean;
  readonly allowComment: boolean;
  readonly private: boolean;
  readonly activities?: readonly string[];
}

export type Question =
  | (QuestionBase & { readonly type: 'text'; readonly guidance?: number | null })
  | (QuestionBase & { readonly type: 'scale'; readonly options: readonly ScaleOption[] })
  | (QuestionBase & { readonly type: 'binary'; readonly yes: string; readonly no: string })
  | (QuestionBase & {
      readonly type: 'choice';
      readonly options: readonly { readonly id: string; readonly label: string }[];
      readonly multiple: boolean;
      readonly min: number | null;
      readonly max: number | null;
    })
  | (QuestionBase & {
      readonly type: 'number';
      readonly min: number | null;
      readonly max: number | null;
      readonly unit: string | null;
    })
  | (QuestionBase & { readonly type: 'performance_score' })
  | (QuestionBase & {
      readonly type: 'goals';
      readonly goalId: string;
      readonly progress: number | null;
    });

export interface Section {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly questions: readonly Question[];
}

export interface FormDefinition {
  readonly title: string;
  readonly description: string | null;
  readonly sections: readonly Section[];
}

export type AnswerValue = string | number | boolean | readonly string[] | null;

export interface Answer {
  readonly value: AnswerValue;
  readonly comment: string | null;
}

export type Answers = Readonly<Record<string, Answer>>;

export interface Score {
  readonly hundredths: number;
  readonly display: string;
  readonly label: string;
  readonly rated: number;
}

export interface Suggestion {
  readonly value: AnswerValue;
  readonly reason: string;
  readonly confirmed: boolean;
}
