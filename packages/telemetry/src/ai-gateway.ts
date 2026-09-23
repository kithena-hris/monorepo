import { contains, haystack, needle, type Haystack } from './free-text.js';
import type { PolicyRegistry } from './policy-registry.js';

/**
 * The one door a prompt leaves the system through.
 *
 * A prompt carrying a field whose policy says `aiEligible: false` is
 * **refused here**, whole, not filtered. Filtering is what a caller would do,
 * and a caller that forgets is how a health condition reaches a third-party
 * model; a gateway that silently dropped the field would instead send a
 * prompt its author did not write and answer a question nobody asked. A
 * refusal is loud, and it names the field, so the caller fixes the prompt.
 *
 * Two checks, in order.
 *
 * **Structured context, by key.** The registry's union: the static paths
 * `just codegen` writes, plus this tenant's own `aiEligible: false`
 * attributes, matched by key at any depth.
 *
 * **Free text, by value.** A value pasted into the instruction — or into a
 * string under an innocent key — is invisible to a key match. So the caller
 * names the people the prompt is about, and the gateway asks the owning
 * module for the current values of their denied attributes (with the
 * caller's authorization applied), and refuses when any of them appears in
 * the text, however it was spaced, cased or punctuated (`free-text.ts`). The
 * values live in this function's memory for the length of the check: never
 * logged, never in a refusal, never sent.
 *
 * A caller that names nobody cannot have its values checked, so it gets the
 * conservative rule instead: any mention of a denied field, by key or by
 * label, is refused, and the refusal says why and what to pass instead.
 *
 * An unloaded tenant is refused outright, and so is a prompt whose subjects
 * cannot be resolved — not knowing the values is not evidence that the text
 * is clean.
 */

export interface Prompt {
  readonly instruction: string;
  /** Every piece of data the model is shown, as the object it came from. */
  readonly context: Readonly<Record<string, unknown>>;
}

/** Who is asking. The same shape the owning module authorizes a read with. */
export interface Caller {
  readonly accountId: string;
  readonly roles: ReadonlySet<string>;
}

/** The people a prompt is about, and who is asking about them. */
export interface Subjects {
  readonly caller: Caller;
  readonly ids: readonly string[];
}

/**
 * The owning module's answer: every current value of `keys` that `caller`
 * may read, for each subject, as text. A subject it cannot resolve is a
 * failure, not an empty list.
 */
export type DeniedValueLookup = (
  tenantId: string,
  subjects: Subjects,
  keys: ReadonlySet<string>,
) => Promise<
  | { readonly ok: true; readonly value: readonly string[] }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
>;

export type GatewayErrorCode =
  | 'AI_POLICY_UNKNOWN'
  | 'AI_FIELD_DENIED'
  | 'AI_VALUE_DENIED'
  | 'AI_FIELD_NAMED'
  | 'AI_SUBJECTS_UNRESOLVED';

export type GatewayResult =
  | { readonly ok: true; readonly value: string }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: GatewayErrorCode;
        readonly message: string;
        readonly path?: readonly string[];
      };
    };

/** What actually talks to a model. Injected, so nothing reaches it without passing the check. */
export type ModelTransport = (prompt: Prompt) => Promise<string>;

export interface AiGateway {
  /** `subjects` omitted, or naming nobody, means the conservative free-text rule. */
  complete(tenantId: string, prompt: Prompt, subjects?: Subjects): Promise<GatewayResult>;
}

type Refusal = Extract<GatewayResult, { ok: false }>;

const refuse = (code: GatewayErrorCode, message: string, path?: readonly string[]): Refusal => ({
  ok: false,
  error: path ? { code, message, path } : { code, message },
});

/** The first denied path in `value`, or undefined. Array indices are not part of a path. */
function firstDenied(
  value: unknown,
  path: readonly string[],
  deny: { readonly paths: ReadonlySet<string>; readonly keys: ReadonlySet<string> },
): readonly string[] | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstDenied(item, path, deny);
      if (found) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== 'object') return undefined;

  for (const [key, child] of Object.entries(value)) {
    const next = [...path, key];
    if (deny.keys.has(key) || deny.paths.has(next.join('.'))) return next;
    const found = firstDenied(child, next, deny);
    if (found) return found;
  }
  return undefined;
}

/** The instruction and every string or number anywhere in the context: what a model reads as text. */
function freeText(prompt: Prompt): Haystack {
  const texts = [prompt.instruction];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') texts.push(value);
    else if (typeof value === 'number' || typeof value === 'bigint') texts.push(String(value));
    else if (value !== null && typeof value === 'object') for (const child of Object.values(value)) visit(child);
  };
  visit(prompt.context);
  return haystack(texts);
}

export function aiGateway(deps: {
  registry: PolicyRegistry;
  send: ModelTransport;
  /** Absent means no module can resolve values, so a prompt naming subjects is refused. */
  deniedValues?: DeniedValueLookup;
}): AiGateway {
  /** Undefined when the free text is clean; otherwise why it is not. Nothing here may log. */
  async function checkFreeText(
    tenantId: string,
    prompt: Prompt,
    denied: { readonly keys: ReadonlySet<string>; readonly names: readonly string[] },
    subjects: Subjects | undefined,
  ): Promise<Refusal | undefined> {
    if (denied.keys.size === 0) return undefined;
    const text = freeText(prompt);

    if (!subjects || subjects.ids.length === 0) {
      const named = denied.names.find((name) => {
        const n = needle(name);
        return n !== undefined && contains(text, n);
      });
      return named === undefined
        ? undefined
        : refuse(
            'AI_FIELD_NAMED',
            `The prompt mentions “${named}”, which may not be sent to a model. No subjects were named, ` +
              'so the gateway cannot check values and refuses any mention of a denied field; pass the ' +
              'people the prompt is about to have their values checked instead',
          );
    }

    if (!deps.deniedValues) {
      return refuse('AI_SUBJECTS_UNRESOLVED', 'No module can resolve these subjects’ values, so nothing may be sent');
    }
    const values = await deps.deniedValues(tenantId, subjects, denied.keys);
    if (!values.ok) {
      return refuse(
        'AI_SUBJECTS_UNRESOLVED',
        `The subjects’ denied values could not be checked (${values.error.code}), so nothing may be sent`,
      );
    }
    // Deliberately says nothing about which value or which person: the
    // refusal is returned to the caller and may well be logged by them.
    const carried = values.value.some((value) => {
      const n = needle(value);
      return n !== undefined && contains(text, n);
    });
    return carried
      ? refuse('AI_VALUE_DENIED', 'The prompt’s text carries a value that may not be sent to a model')
      : undefined;
  }

  return {
    async complete(tenantId, prompt, subjects) {
      const deny = deps.registry.aiDenied(tenantId);
      if (!deny) {
        return refuse('AI_POLICY_UNKNOWN', 'This tenant’s field policies are not loaded, so nothing may be sent');
      }

      const denied = firstDenied(prompt.context, [], deny);
      if (denied) {
        return refuse('AI_FIELD_DENIED', `${denied.join('.')} may not be sent to a model`, denied);
      }

      const refused = await checkFreeText(tenantId, prompt, deny, subjects);
      if (refused) return refused;

      return { ok: true, value: await deps.send(prompt) };
    },
  };
}
