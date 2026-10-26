import { dark, light, scale } from './palette.js';

/**
 * Every email Kithena sends, drawn once: the invitation, the notices and a
 * module's own correspondence fill in the same frame (`FrameView`), so they
 * read as one company's mail.
 *
 * The sender comes first, as a person reads a letter: the company's mark and
 * name, never a label in capitals. Then one card: the heading, what happened in
 * plain sentences, the facts that matter in a summary panel, what happens next
 * as numbered steps, and one button. Under the card, why this came and where
 * to change it.
 *
 * Tables and inline styles because Outlook still renders through Word; Reach's
 * tokens resolved to sRGB (`palette.ts`); dark mode for the clients that keep a
 * style block. Every value given here is already escaped by the caller.
 */
export interface FrameView {
  readonly language: string;
  readonly title: string;
  /** The line beside the subject in the inbox list. */
  readonly preheader: string;
  readonly company: string;
  readonly logo: string | null;
  readonly accent: string;
  readonly paragraphs: readonly string[];
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  readonly times: {
    readonly title: string;
    readonly note: string | null;
    readonly days: readonly { readonly day: string; readonly times: readonly string[] }[];
  } | null;
  /** What happens next, in order; none, no list. */
  readonly steps: { readonly title: string; readonly items: readonly string[] } | null;
  readonly action: { readonly label: string; readonly href: string } | null;
  readonly secondary: { readonly label: string; readonly href: string } | null;
  /** Small print inside the card, under the button: how long a link lasts. */
  readonly note: string | null;
  /** Why this email came. */
  readonly footer: string;
  /** Where to change what reaches you, when there is a place. */
  readonly manage: { readonly label: string; readonly href: string } | null;
}


export function frame(view: FrameView): string {
  return `<!doctype html>
<html lang="${view.language}" style="margin:0;padding:0;">
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
        .k-rule { background: ${dark.border} !important; border-color: ${dark.border} !important; }
        .k-chip { background: ${dark['accent-subtle']} !important; color: ${dark['accent-fg']} !important; border-color: ${dark['accent-subtle']} !important; }
      }
      @media only screen and (max-width: 600px) {
        .k-pad { padding-left: 20px !important; padding-right: 20px !important; }
        .k-button { display: block !important; width: 100% !important; }
        .k-label { width: 96px !important; }
      }
    </style>
  </head>
  <body class="k-canvas" style="margin:0;padding:0;width:100%;background:${light.canvas};font-family:${scale.fontFamily};-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${view.preheader}${'&#847;&zwnj;&nbsp;'.repeat(30)}</div>
    <table role="presentation" class="k-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${light.canvas};">
      <tr>
        <td align="center" style="padding:36px 12px 44px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
${sender(view)}            <tr>
              <td class="k-surface" style="background:${light.surface};border:1px solid ${light.border};border-radius:${scale.radiusCard};overflow:hidden;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr><td style="height:4px;line-height:4px;font-size:0;background:${view.accent};">&nbsp;</td></tr>
                  <tr>
                    <td class="k-pad" style="padding:30px 32px 0 32px;">
                      <h1 class="k-fg" style="margin:0;font-size:${scale.heading.size};line-height:${scale.heading.lineHeight};letter-spacing:${scale.heading.tracking};font-weight:700;color:${light.fg};">${view.title}</h1>
                    </td>
                  </tr>
                  <tr>
                    <td class="k-pad k-fg" style="padding:16px 32px 0 32px;font-size:${scale.body.size};line-height:26px;color:${light.fg};">
${view.paragraphs.map((p) => `                      <p style="margin:0 0 14px 0;">${p}</p>`).join('\n')}
                    </td>
                  </tr>
${facts(view)}${times(view)}${steps(view)}${actions(view)}${note(view)}                  <tr><td style="height:32px;line-height:32px;font-size:0;">&nbsp;</td></tr>
                </table>
              </td>
            </tr>
${footer(view)}          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** The company, as its mail is signed: its mark, else its initial on its colour, then its name. */
function sender(view: FrameView): string {
  const initial =
    view.company
      .replace(/&[a-z#0-9]+;/giu, '')
      .trim()
      .charAt(0)
      .toUpperCase() || 'K';
  const mark =
    view.logo === null
      ? `<td width="36" valign="middle" style="width:36px;"><div style="width:36px;height:36px;line-height:36px;border-radius:10px;background:${view.accent};color:${light['fg-on-accent']};font-size:16px;font-weight:700;text-align:center;">${initial}</div></td>`
      : `<td valign="middle" style="padding-right:12px;"><img src="${view.logo}" alt="" height="36" style="height:36px;max-width:160px;width:auto;border:0;outline:none;display:block;border-radius:8px;" /></td>`;
  return `            <tr>
              <td style="padding:0 4px 18px 4px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    ${mark}
                    <td valign="middle" class="k-fg" style="padding-left:${view.logo === null ? '12px' : '0'};font-size:16px;line-height:22px;font-weight:600;color:${light.fg};">${view.company}</td>
                  </tr>
                </table>
              </td>
            </tr>
`;
}

/** The facts, as a summary: label beside value, a hairline between rows. */
function facts(view: FrameView): string {
  if (view.facts.length === 0) return '';
  const rows = view.facts
    .map(
      (f, i) => `                          <tr>
                            <td valign="top" class="k-muted k-label" style="padding:12px 16px 12px 0;width:132px;font-size:${scale.small.size};line-height:20px;color:${light['fg-muted']};${i === 0 ? '' : `border-top:1px solid ${light.border};`}">${f.label}</td>
                            <td valign="top" class="k-fg" style="padding:12px 0;font-size:15px;line-height:22px;font-weight:600;color:${light.fg};word-break:break-word;${i === 0 ? '' : `border-top:1px solid ${light.border};`}">${f.value}</td>
                          </tr>`,
    )
    .join('\n');
  return `                  <tr>
                    <td class="k-pad" style="padding:6px 32px 0 32px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="k-inset" style="background:${light['surface-sunken']};border:1px solid ${light.border};border-radius:${scale.radiusCard};">
                        <tr>
                          <td style="padding:4px 20px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${rows}
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
`;
}

/** Times a day to a row: the day, then its times as pills. */
function times(view: FrameView): string {
  if (view.times === null) return '';
  const rows = view.times.days
    .map(
      (d, i) => `                          <tr>
                            <td valign="top" class="k-fg k-label" style="padding:${i === 0 ? '0' : '12px'} 14px 0 0;width:150px;font-size:${scale.small.size};line-height:28px;font-weight:600;color:${light.fg};white-space:nowrap;">${d.day}</td>
                            <td valign="top" style="padding:${i === 0 ? '0' : '12px'} 0 0 0;">
${d.times.map((t) => `                              <span class="k-chip" style="display:inline-block;margin:0 6px 6px 0;padding:4px 12px;border-radius:999px;border:1px solid ${light['accent-subtle']};background:${light['accent-subtle']};color:${light['accent-fg']};font-size:${scale.small.size};line-height:20px;font-weight:500;white-space:nowrap;">${t}</span>`).join('\n')}
                            </td>
                          </tr>`,
    )
    .join('\n');
  return `                  <tr>
                    <td class="k-pad" style="padding:14px 32px 0 32px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="k-inset" style="background:${light['surface-sunken']};border:1px solid ${light.border};border-radius:${scale.radiusCard};">
                        <tr>
                          <td style="padding:16px 20px;">
                            <div class="k-fg" style="font-size:15px;line-height:22px;font-weight:600;color:${light.fg};padding-bottom:12px;">${view.times.title}</div>
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${rows}
                            </table>
${view.times.note === null ? '' : `                            <div class="k-muted" style="padding-top:8px;font-size:${scale.small.size};line-height:20px;color:${light['fg-muted']};">${view.times.note}</div>\n`}                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
`;
}

/** What happens next: a numbered list, each number in the company's colour. */
function steps(view: FrameView): string {
  if (view.steps === null || view.steps.items.length === 0) return '';
  const rows = view.steps.items
    .map(
      (s, i) => `                        <tr>
                          <td valign="top" width="36" style="width:36px;padding:${i === 0 ? '0' : '10px'} 0 0 0;">
                            <div class="k-chip" style="width:24px;height:24px;line-height:24px;border-radius:999px;background:${light['accent-subtle']};color:${light['accent-fg']};font-size:13px;font-weight:700;text-align:center;">${String(i + 1)}</div>
                          </td>
                          <td valign="top" class="k-fg" style="padding:${i === 0 ? '1px' : '11px'} 0 0 0;font-size:15px;line-height:22px;color:${light.fg};">${s}</td>
                        </tr>`,
    )
    .join('\n');
  return `                  <tr>
                    <td class="k-pad" style="padding:22px 32px 0 32px;">
                      <div class="k-fg" style="font-size:15px;line-height:22px;font-weight:600;color:${light.fg};padding-bottom:12px;">${view.steps.title}</div>
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${rows}
                      </table>
                    </td>
                  </tr>
`;
}

function actions(view: FrameView): string {
  if (view.action === null && view.secondary === null) return '';
  const primary =
    view.action === null
      ? ''
      : `                      <!--[if mso]>
                      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${view.action.href}" style="height:${scale.controlHeight};v-text-anchor:middle;width:260px;" arcsize="18%" stroke="f" fillcolor="${view.accent}">
                        <w:anchorlock/>
                        <center style="color:${light['fg-on-accent']};font-family:'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:600;">${view.action.label}</center>
                      </v:roundrect>
                      <![endif]-->
                      <!--[if !mso]><!-- -->
                      <a href="${view.action.href}" class="k-button" style="display:inline-block;box-sizing:border-box;height:${scale.controlHeight};line-height:${scale.controlHeight};padding:0 24px;background:${view.accent};color:${light['fg-on-accent']};font-size:16px;font-weight:600;text-align:center;text-decoration:none;border-radius:${scale.radiusControl};mso-hide:all;">${view.action.label}</a>
                      <!--<![endif]-->`;
  const quiet =
    view.secondary === null
      ? ''
      : `                      <div style="padding-top:${view.action === null ? '0' : '16px'};font-size:15px;line-height:22px;"><a href="${view.secondary.href}" style="color:${view.accent};text-decoration:underline;text-underline-offset:3px;font-weight:600;">${view.secondary.label}</a></div>`;
  return `                  <tr>
                    <td class="k-pad" style="padding:26px 32px 0 32px;">
${primary}
${quiet}
                    </td>
                  </tr>
`;
}

function note(view: FrameView): string {
  return view.note === null
    ? ''
    : `                  <tr>
                    <td class="k-pad k-muted" style="padding:18px 32px 0 32px;font-size:${scale.small.size};line-height:20px;color:${light['fg-muted']};">${view.note}</td>
                  </tr>
`;
}

/** Why it came, where to change it, and who sent it. */
function footer(view: FrameView): string {
  return `            <tr>
              <td class="k-muted" style="padding:20px 8px 0 8px;font-size:13px;line-height:20px;color:${light['fg-muted']};">
                ${view.footer}${
                  view.manage === null
                    ? ''
                    : ` <a href="${view.manage.href}" style="color:${light['fg-muted']};text-decoration:underline;text-underline-offset:2px;">${view.manage.label}</a>`
                }
              </td>
            </tr>
`;
}
