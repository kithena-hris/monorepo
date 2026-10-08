/**
 * A scheduled report, as People takes one (`CreateReportSchedule`): the web's
 * `ScheduleDraft` and `scheduleVariables`, one place for the export builder's
 * Schedule and for Insights' scheduled reports.
 */
export interface ScheduleDraft {
  readonly name: string;
  readonly segmentId: string | null;
  readonly filter: readonly { readonly key: string; readonly value: string }[];
  readonly kind: 'export' | 'summary';
  readonly format: 'xlsx' | 'pdf';
  readonly fields: readonly string[] | null;
  readonly reason: string | null;
  readonly every: 'day' | 'week' | 'month';
  readonly weekday: number;
  readonly day: number;
  readonly hour: number;
  readonly legalEntityId: string | null;
  readonly recipients: readonly string[];
}

export const scheduleVariables = (d: ScheduleDraft): Record<string, unknown> => ({
  name: d.name,
  segmentId: d.segmentId,
  filter: d.segmentId === null ? d.filter : null,
  kind: d.kind,
  format: d.kind === 'export' ? d.format : null,
  fields: d.kind === 'export' ? d.fields : null,
  reason: d.kind === 'export' ? d.reason : null,
  every: d.every,
  weekday: d.every === 'week' ? d.weekday : null,
  day: d.every === 'month' ? d.day : null,
  hour: d.hour,
  legalEntityId: d.legalEntityId,
  recipients: d.recipients,
});
