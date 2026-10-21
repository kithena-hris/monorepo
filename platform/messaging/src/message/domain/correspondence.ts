import { accentHex } from '@kithena/contracts';
import { err, ok, type Result } from '@kithena/domain-kit';

import { escapeHtml, safeHref, safeImageSrc } from './markup.js';
import { Unrenderable, type RenderedMessage } from './invitation.js';
import { dark, light, scale } from './palette.js';

/**
 * Correspondence: an email a module wrote word for word, to somebody outside
 * the company who is not a user — a candidate (Recruiting PRD §12.7).
 *
 * The one kind of message here whose words are not this service's. A
 * candidate's thread is the feature, so Recruiting writes it and keeps it;
 * messaging sends it and, as for everything else, records the outcome and
 * never the body.
 *
 * It is drawn as the sign-up email is drawn (`invitation.ts`): the company's
 * name above an outlined card with its accent rule, its logo, a heading and
 * the words. A module may add structure, never markup: times grouped by day,
 * a few facts, one button and one quieter link. Every value is escaped here
 * and every link must be `https:`, so a caller still cannot put HTML in front
 * of a candidate.
 */
export const CORRESPONDENCE_KIND = 'correspondence';

/** What a module may lay out beside its words. */
export interface CorrespondenceParts {
  /** The card's heading; the subject when absent. */
  readonly heading?: string | null | undefined;
  /** Times grouped by day, read at a glance: "Tuesday 4 November" over "10:00 – 10:45". */
  readonly times?:
    | {
        readonly title: string;
        readonly days: readonly { readonly day: string; readonly times: readonly string[] }[];
        readonly note?: string | null | undefined;
      }
    | null
    | undefined;
  /** A few labelled facts: when, where, how long. */
  readonly facts?: readonly { readonly label: string; readonly value: string }[] | undefined;
  /** The one thing to do. */
  readonly action?: { readonly label: string; readonly href: string } | null | undefined;
  /** A quieter second thing: change my times, ask for another. */
  readonly secondary?: { readonly label: string; readonly href: string } | null | undefined;
  /** The company's theme preset and mark, as its careers page shows them. */
  readonly themeId?: string | null | undefined;
  readonly logoUrl?: string | null | undefined;
}

const LIMITS = { days: 14, timesPerDay: 24, facts: 8, label: 120, value: 500 } as const;

export function renderCorrespondence(
  subject: string,
  text: string,
  companyName: string,
  parts: CorrespondenceParts = {},
): Result<RenderedMessage> {
  const heading = subject.trim();
  const body = text.trim();
  if (
    heading === '' ||
    body === '' ||
    heading.length > 300 ||
    body.length > 20_000 ||
    /[\r\n]/u.test(heading)
  ) {
    return err(Unrenderable);
  }
  const days = (parts.times?.days ?? []).slice(0, LIMITS.days).map((d) => ({
    day: d.day.slice(0, LIMITS.label),
    times: d.times.slice(0, LIMITS.timesPerDay).map((t) => t.slice(0, LIMITS.label)),
  }));
  const facts = (parts.facts ?? [])
    .slice(0, LIMITS.facts)
    .map((f) => ({ label: f.label.slice(0, LIMITS.label), value: f.value.slice(0, LIMITS.value) }));
  // A link that is not plainly https is dropped, never rendered: the words still say what to do.
  const action =
    parts.action == null ? null : link(parts.action.label, safeHref(parts.action.href));
  const secondary =
    parts.secondary == null ? null : link(parts.secondary.label, safeHref(parts.secondary.href));
  const title = (parts.heading ?? '').trim() === '' ? heading : (parts.heading ?? '').trim();
  const view: View = {
    company: escapeHtml(companyName),
    title: escapeHtml(title.slice(0, 200)),
    paragraphs: body.split(/\n{2,}/u).map((p) => escapeHtml(p).replace(/\n/gu, '<br />')),
    times:
      parts.times == null || days.length === 0
        ? null
        : {
            title: escapeHtml(parts.times.title.slice(0, LIMITS.label)),
            note: parts.times.note == null ? null : escapeHtml(parts.times.note.slice(0, 300)),
            days: days.map((d) => ({ day: escapeHtml(d.day), times: d.times.map(escapeHtml) })),
          },
    facts: facts.map((f) => ({ label: escapeHtml(f.label), value: escapeHtml(f.value) })),
    action,
    secondary,
    logo: safeImageSrc(parts.logoUrl ?? null),
    accent: accentHex(parts.themeId) ?? light['accent-solid'],
  };
  return ok({
    subject: heading,
    html: html(view),
    text: plain({
      body,
      companyName,
      parts: { days, facts },
      action: parts.action,
      secondary: parts.secondary,
      timesTitle: parts.times?.title ?? null,
    }),
  });
}

const link = (label: string, href: string | null): { label: string; href: string } | null =>
  href === null || label.trim() === ''
    ? null
    : { label: escapeHtml(label.trim().slice(0, 60)), href };

interface View {
  readonly company: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly times: {
    readonly title: string;
    readonly note: string | null;
    readonly days: readonly { readonly day: string; readonly times: readonly string[] }[];
  } | null;
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  readonly action: { readonly label: string; readonly href: string } | null;
  readonly secondary: { readonly label: string; readonly href: string } | null;
  readonly logo: string | null;
  readonly accent: string;
}

/**
 * The card, in the subset of HTML a mail client keeps: tables and inline
 * styles, Reach's tokens resolved to sRGB, dark mode for the clients that
 * honour it (see `invitation.ts` for why each of these is so).
 */
function html(view: View): string {
  const pad = scale.cardPadding;
  const preheader = view.paragraphs[0]?.replaceAll('<br />', ' ').slice(0, 140) ?? '';
  return `<!doctype html>
<html lang="en" style="margin:0;padding:0;">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${view.title}</title>
    <!--[if mso]><style>* { font-family: 'Segoe UI', Arial, sans-serif !important; }</style><![endif]-->
    <style>
      @media (prefers-color-scheme: dark) {
        .k-canvas { background: ${dark.canvas} !important; }
        .k-surface { background: ${dark.surface} !important; border-color: ${dark.border} !important; }
        .k-inset { background: ${dark['surface-sunken']} !important; border-color: ${dark.border} !important; }
        .k-fg { color: ${dark.fg} !important; }
        .k-muted { color: ${dark['fg-muted']} !important; }
        .k-rule { background: ${dark.border} !important; }
        .k-chip { background: ${dark['accent-subtle']} !important; color: ${dark['accent-fg']} !important; border-color: ${dark.border} !important; }
      }
      @media only screen and (max-width: 600px) {
        .k-pad { padding-left: 18px !important; padding-right: 18px !important; }
        .k-button { display: block !important; }
      }
    </style>
  </head>
  <body class="k-canvas" style="margin:0;padding:0;width:100%;background:${light.canvas};font-family:${scale.fontFamily};-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheader}${'&#847;&zwnj;&nbsp;'.repeat(30)}</div>
    <table role="presentation" class="k-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${light.canvas};">
      <tr>
        <td align="center" style="padding:40px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
            <tr>
              <td style="padding:0 4px 18px 4px;">
                <span style="font-size:${scale.tiny.size};line-height:${scale.tiny.lineHeight};font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:${view.accent};">${view.company}</span>
              </td>
            </tr>
            <tr>
              <td class="k-surface" style="background:${light.surface};border:1px solid ${light.border};border-radius:${scale.radiusCard};overflow:hidden;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="height:3px;line-height:3px;font-size:0;background:${view.accent};">&nbsp;</td>
                  </tr>
${
  view.logo === null
    ? ''
    : `                  <tr>
                    <td class="k-pad" style="padding:26px ${pad} 0 ${pad};">
                      <img src="${view.logo}" alt="${view.company}" height="28" style="height:28px;max-width:180px;width:auto;border:0;outline:none;display:block;" />
                    </td>
                  </tr>
`
}                  <tr>
                    <td class="k-pad" style="padding:${view.logo === null ? '28px' : '18px'} ${pad} 0 ${pad};">
                      <h1 class="k-fg" style="margin:0;font-size:${scale.heading.size};line-height:${scale.heading.lineHeight};letter-spacing:${scale.heading.tracking};font-weight:600;color:${light.fg};">${view.title}</h1>
                    </td>
                  </tr>
                  <tr>
                    <td class="k-pad k-fg" style="padding:14px ${pad} 0 ${pad};font-size:${scale.body.size};line-height:${scale.body.lineHeight};color:${light.fg};">
${view.paragraphs.map((p) => `                      <p style="margin:0 0 14px 0;">${p}</p>`).join('\n')}
                    </td>
                  </tr>
${times(view, pad)}${facts(view, pad)}${actions(view, pad)}                  <tr>
                    <td style="height:${pad};line-height:${pad};font-size:0;">&nbsp;</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="k-muted" style="padding:18px 4px 0 4px;font-size:${scale.tiny.size};line-height:${scale.tiny.lineHeight};color:${light['fg-muted']};">
                Sent by ${view.company} about your application. Reply to this email to answer them.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * The times, a day to a row: the day in the left column, its times as
 * pills beside it, so ten times across five days read in one glance.
 */
function times(view: View, pad: string): string {
  if (view.times === null) return '';
  const rows = view.times.days
    .map(
      (d, i) => `                          <tr>
                            <td valign="top" class="k-fg" style="padding:${i === 0 ? '0' : '12px'} 14px 0 0;width:150px;font-size:${scale.small.size};line-height:28px;font-weight:600;color:${light.fg};white-space:nowrap;">${d.day}</td>
                            <td valign="top" style="padding:${i === 0 ? '0' : '12px'} 0 0 0;">
${d.times
  .map(
    (t) =>
      `                              <span class="k-chip" style="display:inline-block;margin:0 6px 6px 0;padding:4px 12px;border-radius:999px;border:1px solid ${light['accent-subtle']};background:${light['accent-subtle']};color:${light['accent-fg']};font-size:${scale.small.size};line-height:20px;font-weight:500;white-space:nowrap;">${t}</span>`,
  )
  .join('\n')}
                            </td>
                          </tr>`,
    )
    .join('\n');
  return `                  <tr>
                    <td class="k-pad" style="padding:8px ${pad} 0 ${pad};">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="k-inset" style="background:${light['surface-sunken']};border:1px solid ${light.border};border-radius:${scale.radiusInset};">
                        <tr>
                          <td style="padding:14px 16px;">
                            <div class="k-muted" style="font-size:${scale.tiny.size};line-height:${scale.tiny.lineHeight};letter-spacing:0.07em;text-transform:uppercase;color:${light['fg-muted']};padding-bottom:10px;">${view.times.title}</div>
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${rows}
                            </table>
${
  view.times.note === null
    ? ''
    : `                            <div class="k-muted" style="padding-top:8px;font-size:${scale.tiny.size};line-height:${scale.tiny.lineHeight};color:${light['fg-muted']};">${view.times.note}</div>
`
}                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
`;
}

function facts(view: View, pad: string): string {
  if (view.facts.length === 0) return '';
  const rows = view.facts
    .map(
      (f) => `                          <tr>
                            <td valign="top" class="k-muted" style="padding:4px 14px 4px 0;width:110px;font-size:${scale.small.size};line-height:${scale.small.lineHeight};color:${light['fg-muted']};">${f.label}</td>
                            <td valign="top" class="k-fg" style="padding:4px 0;font-size:${scale.small.size};line-height:${scale.small.lineHeight};font-weight:500;color:${light.fg};word-break:break-word;">${f.value}</td>
                          </tr>`,
    )
    .join('\n');
  return `                  <tr>
                    <td class="k-pad" style="padding:12px ${pad} 0 ${pad};">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${rows}
                      </table>
                    </td>
                  </tr>
`;
}

function actions(view: View, pad: string): string {
  if (view.action === null && view.secondary === null) return '';
  const primary =
    view.action === null
      ? ''
      : `                      <!--[if mso]>
                      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${view.action.href}" style="height:${scale.controlHeight};v-text-anchor:middle;width:240px;" arcsize="18%" stroke="f" fillcolor="${view.accent}">
                        <w:anchorlock/>
                        <center style="color:${light['fg-on-accent']};font-family:'Segoe UI',Arial,sans-serif;font-size:${scale.body.size};font-weight:500;">${view.action.label}</center>
                      </v:roundrect>
                      <![endif]-->
                      <!--[if !mso]><!-- -->
                      <a href="${view.action.href}" class="k-button" style="display:inline-block;box-sizing:border-box;height:${scale.controlHeight};line-height:${scale.controlHeight};padding:0 22px;background:${view.accent};color:${light['fg-on-accent']};font-size:${scale.body.size};font-weight:500;text-align:center;text-decoration:none;border-radius:${scale.radiusControl};mso-hide:all;">${view.action.label}</a>
                      <!--<![endif]-->`;
  const quiet =
    view.secondary === null
      ? ''
      : `                      <div style="padding-top:${view.action === null ? '0' : '14px'};font-size:${scale.small.size};line-height:${scale.small.lineHeight};"><a href="${view.secondary.href}" style="color:${view.accent};text-decoration:underline;font-weight:500;">${view.secondary.label}</a></div>`;
  return `                  <tr>
                    <td class="k-pad" style="padding:20px ${pad} 0 ${pad};">
${primary}
${quiet}
                    </td>
                  </tr>
`;
}

/** The same message as text, for the clients and filters that read only that part. */
function plain(v: {
  body: string;
  companyName: string;
  parts: {
    days: readonly { day: string; times: readonly string[] }[];
    facts: readonly { label: string; value: string }[];
  };
  timesTitle: string | null;
  action: CorrespondenceParts['action'];
  secondary: CorrespondenceParts['secondary'];
}): string {
  return [
    v.body,
    ...(v.parts.days.length === 0
      ? []
      : [
          '',
          v.timesTitle ?? 'Times',
          ...v.parts.days.map((d) => `  ${d.day}: ${d.times.join(', ')}`),
        ]),
    ...(v.parts.facts.length === 0
      ? []
      : ['', ...v.parts.facts.map((f) => `${f.label}: ${f.value}`)]),
    ...(v.action == null || safeHref(v.action.href) === null
      ? []
      : ['', `${v.action.label}:`, v.action.href]),
    ...(v.secondary == null || safeHref(v.secondary.href) === null
      ? []
      : ['', `${v.secondary.label}:`, v.secondary.href]),
    '',
    v.companyName,
  ].join('\n');
}
