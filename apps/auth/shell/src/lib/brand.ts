import { themePreset } from '@kithena/contracts';
import { brandRamp } from '@reach/ui';
import { useEffect } from 'react';

/**
 * Put a company's colour on this origin, for as long as their screen is open.
 *
 * ### Why it has to be `<html>`
 *
 * `brandRamp` documents this at length; the short version is that
 * `tokens.css` declares `--reach-color-accent: var(--reach-brand-600)` **on
 * `:root`**, and a `var()` is substituted where the declaration lives rather
 * than where it is finally read. A ramp set on a wrapper re-points a variable
 * that nothing consults again, and the failure is quiet: the wrapper inherits
 * the new hue correctly and every button, ring and wash stays the old one.
 *
 * ### Why it is imperative rather than a `style` prop
 *
 * `apps/web` can set the ramp declaratively because it resolves its tenant on
 * the server, from the Host header, before it renders. This origin serves
 * every customer from one hostname and learns which one it is talking to in
 * the browser, so there is no server render that knows the company and the
 * document element is the only place left to write to.
 *
 * ### Why it is a hook and not three copies of an effect
 *
 * Because it was three copies of an effect. Sign-in had one, enrolment had a
 * second, and the next screen added to this origin would have had none —
 * which is the failure that matters: a company changes their theme in the
 * back office, it reaches the tenant app and the invitation email, and one
 * page on the way in is still Kithena indigo. A screen opts in with one line
 * or it does not, and that is visible in a diff.
 */
export function useBrandRamp(themeId: string | null): void {
  useEffect(() => {
    const preset = themeId === null ? undefined : themePreset(themeId);
    if (!preset) return;

    const root = document.documentElement;
    const ramp = brandRamp(preset.hue) as Record<string, string>;
    for (const [name, value] of Object.entries(ramp)) root.style.setProperty(name, value);

    // Removed on the way out, which is not housekeeping. This origin serves
    // more than one company and a ramp left behind is the previous customer's
    // colour on the next one's sign-in page.
    return () => {
      for (const name of Object.keys(ramp)) root.style.removeProperty(name);
    };
  }, [themeId]);
}
