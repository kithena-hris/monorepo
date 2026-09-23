import type { PolicyRegistry } from './policy-registry.js';

/**
 * The one door a prompt leaves the system through.
 *
 * A prompt carrying a field whose policy says `aiEligible: false` is
 * **refused here**, whole, not filtered. Filtering is what a caller would do,
 * and a caller that forgets is how a health condition reaches a third-party
 * model; a gateway that silently dropped the field would instead send a
 * prompt its author did not write and answer a question nobody asked. A
 * refusal is loud, and it names the path, so the caller fixes the prompt.
 *
 * The deny list is the registry's union: the static paths `just codegen`
 * writes, plus this tenant's own `aiEligible: false` attributes, matched by
 * key at any depth. An unloaded tenant is refused outright.
 *
 * Structured context only. A value pasted into `instruction` as prose is not
 * something a key match can see, which is why callers put person data in
 * `context` and nowhere else.
 */

export interface Prompt {
  readonly instruction: string;
  /** Every piece of data the model is shown, as the object it came from. */
  readonly context: Readonly<Record<string, unknown>>;
}

export type GatewayResult =
  | { readonly ok: true; readonly value: string }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: 'AI_POLICY_UNKNOWN' | 'AI_FIELD_DENIED';
        readonly message: string;
        readonly path?: readonly string[];
      };
    };

/** What actually talks to a model. Injected, so nothing reaches it without passing the check. */
export type ModelTransport = (prompt: Prompt) => Promise<string>;

export interface AiGateway {
  complete(tenantId: string, prompt: Prompt): Promise<GatewayResult>;
}

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

export function aiGateway(deps: { registry: PolicyRegistry; send: ModelTransport }): AiGateway {
  return {
    async complete(tenantId, prompt) {
      const deny = deps.registry.aiDenied(tenantId);
      if (!deny) {
        return {
          ok: false,
          error: {
            code: 'AI_POLICY_UNKNOWN',
            message: 'This tenant’s field policies are not loaded, so nothing may be sent',
          },
        };
      }

      const denied = firstDenied(prompt.context, [], deny);
      if (denied) {
        return {
          ok: false,
          error: {
            code: 'AI_FIELD_DENIED',
            message: `${denied.join('.')} may not be sent to a model`,
            path: denied,
          },
        };
      }

      return { ok: true, value: await deps.send(prompt) };
    },
  };
}
