/** The session's code in what a scan read: the code itself, or a link that carries it as `?code=`. */
export function sessionCode(read: string): string {
  const text = read.trim();
  if (!/^[a-z][a-z0-9+.-]*:/iu.test(text)) return text;
  try {
    return new URL(text).searchParams.get('code')?.trim() ?? text;
  } catch {
    return text;
  }
}
