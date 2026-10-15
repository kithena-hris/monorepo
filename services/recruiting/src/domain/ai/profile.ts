/**
 * A CV as a model read it (PRD §14.2), checked by code before anyone sees
 * it. Every value carries the passage it came from; a value whose passage is
 * not in the text, or is not in its own passage, is dropped rather than
 * trusted. Dates out of order and end dates after today are flagged for a
 * person, never fixed: the candidate confirms their profile, and a recruiter
 * reads it beside the CV.
 */

export interface Passaged {
  readonly value: string;
  readonly passage: string;
}

export interface Job {
  readonly employer: Passaged;
  readonly title: Passaged;
  /** `YYYY-MM` or `YYYY`. */
  readonly from: Passaged;
  readonly to: Passaged | null;
}

export interface Profile {
  readonly work: readonly Job[];
  readonly education: readonly {
    readonly institution: Passaged;
    readonly qualification: Passaged | null;
    readonly to: Passaged | null;
  }[];
  readonly skills: readonly Passaged[];
  readonly languages: readonly (Passaged & { readonly level: string | null })[];
  readonly certifications: readonly Passaged[];
}

export interface ProfileIssue {
  readonly code: 'not_in_text' | 'dates_out_of_order' | 'end_in_future';
  readonly path: string;
}

const flat = (s: string) => s.toLowerCase().replace(/\s+/gu, ' ').trim();

export function checkProfile(
  profile: Profile,
  text: string,
  today: string,
): { readonly profile: Profile; readonly issues: readonly ProfileIssue[] } {
  const haystack = flat(text);
  const issues: ProfileIssue[] = [];
  const found = (p: Passaged | null | undefined, path: string): p is Passaged => {
    if (p == null) return false;
    const ok =
      p.passage.trim() !== '' &&
      haystack.includes(flat(p.passage)) &&
      flat(p.passage).includes(flat(p.value));
    if (!ok) issues.push({ code: 'not_in_text', path });
    return ok;
  };
  const list = <T extends Passaged>(items: readonly T[], path: string) =>
    items.filter((item, i) => found(item, `${path}.${String(i)}`));

  const work: Job[] = [];
  profile.work.forEach((job, i) => {
    const at = `work.${String(i)}`;
    if (!found(job.employer, `${at}.employer`) || !found(job.title, `${at}.title`)) return;
    if (!found(job.from, `${at}.from`)) return;
    const to = job.to !== null && found(job.to, `${at}.to`) ? job.to : null;
    if (to !== null && to.value < job.from.value)
      issues.push({ code: 'dates_out_of_order', path: at });
    if (to !== null && to.value.slice(0, 7) > today.slice(0, 7))
      issues.push({ code: 'end_in_future', path: at });
    work.push({ ...job, to });
  });

  const education = profile.education.flatMap((e, i) => {
    const at = `education.${String(i)}`;
    if (!found(e.institution, `${at}.institution`)) return [];
    return [
      {
        institution: e.institution,
        qualification:
          e.qualification !== null && found(e.qualification, `${at}.qualification`)
            ? e.qualification
            : null,
        to: e.to !== null && found(e.to, `${at}.to`) ? e.to : null,
      },
    ];
  });

  return {
    profile: {
      work,
      education,
      skills: list(profile.skills, 'skills'),
      languages: list(profile.languages, 'languages'),
      certifications: list(profile.certifications, 'certifications'),
    },
    issues,
  };
}
