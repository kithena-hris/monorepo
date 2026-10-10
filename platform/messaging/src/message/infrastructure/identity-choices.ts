/**
 * A person's notification settings, as identity keeps them with their account
 * (`/api/internal/tenants/<t>/accounts/<a>/preferences/notifications`): read
 * for the Inbox's email, behind the internal token. Null when identity cannot
 * be asked or has none, and the defaults then apply.
 */
export function identityChoices(config: { readonly baseUrl: string; readonly token: string }) {
  return async (tenantId: string, accountId: string): Promise<unknown> => {
    const url = new URL(
      `/api/internal/tenants/${encodeURIComponent(tenantId)}/accounts/${encodeURIComponent(accountId)}/preferences/notifications`,
      config.baseUrl,
    );
    const response = await fetch(url, {
      headers: { 'x-internal-token': config.token },
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);
    if (response?.ok !== true) return null;
    const body = (await response.json().catch(() => null)) as { value?: unknown } | null;
    return body?.value ?? null;
  };
}
