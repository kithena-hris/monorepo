'use client';

import { COUNTRIES, countryRules, type CandidateDetails } from '@kithena/contracts';
import {
  DatePicker,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  PhoneField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@reach/ui';
import type { JSX } from 'react';

import { t as tr } from '../lib/i18n';

/** The form's own copy of a candidate's details: every box a string, as typed. */
export interface DetailsDraft {
  readonly preferredName: string;
  readonly dateOfBirth: string | null;
  readonly personalEmail: string;
  readonly mobilePhone: string;
  readonly country: string;
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly subdivision: string;
  readonly postcode: string;
}

const text = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/** What they gave before, or nothing yet. */
export function draftOf(given: CandidateDetails | null | undefined): DetailsDraft {
  const a = given?.homeAddress ?? null;
  return {
    preferredName: given?.preferredName ?? '',
    dateOfBirth: given?.dateOfBirth ?? null,
    personalEmail: given?.personalEmail ?? '',
    mobilePhone: given?.mobilePhone ?? '',
    country: a?.country ?? '',
    line1: a?.line1 ?? '',
    line2: a?.line2 ?? '',
    city: a?.city ?? '',
    subdivision: a?.subdivision ?? '',
    postcode: a?.postcode ?? '',
  };
}

/**
 * The details as the company keeps them: only what was given, the address
 * only once it has a country, a street and a town, the mobile number without
 * its spaces.
 */
export function detailsOf(d: DetailsDraft): CandidateDetails {
  const phone = d.mobilePhone.replaceAll(/[\s().-]/gu, '');
  return {
    preferredName: text(d.preferredName),
    dateOfBirth: d.dateOfBirth,
    personalEmail: text(d.personalEmail),
    mobilePhone: /^\+[1-9]\d{6,14}$/u.test(phone) ? phone : null,
    homeAddress:
      d.country === '' || text(d.line1) === null || text(d.city) === null
        ? null
        : {
            country: d.country,
            line1: d.line1.trim(),
            line2: text(d.line2),
            city: d.city.trim(),
            subdivision: text(d.subdivision),
            postcode: text(d.postcode),
          },
  };
}

/**
 * What only the candidate knows and their contract and record need, asked
 * once they accept the offer: stated in the contract for them to check.
 */
export function DetailsForm({
  value,
  onChange,
}: {
  readonly value: DetailsDraft;
  readonly onChange: (next: DetailsDraft) => void;
}): JSX.Element {
  const set = (patch: Partial<DetailsDraft>) => {
    onChange({ ...value, ...patch });
  };
  const rules = value.country === '' ? undefined : countryRules(value.country);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-muted">
        {tr(
          'components.details-form.why',
          'Your contract states these for you to check before you sign, and your employee record starts with them.',
        )}
      </p>
      <Field>
        <FieldLabel>{tr('components.details-form.preferred_name', 'Preferred name')}</FieldLabel>
        <FieldDescription>
          {tr('components.details-form.preferred_name_hint', 'If you go by another first name.')}
        </FieldDescription>
        <FieldControl>
          <Input
            autoComplete="nickname"
            value={value.preferredName}
            onChange={(e) => {
              set({ preferredName: e.target.value });
            }}
          />
        </FieldControl>
      </Field>
      <DatePicker
        label={tr('components.details-form.date_of_birth', 'Date of birth')}
        value={value.dateOfBirth}
        onChange={(next) => {
          set({ dateOfBirth: next });
        }}
      />
      <Field>
        <FieldLabel>{tr('components.details-form.personal_email', 'Personal email')}</FieldLabel>
        <FieldControl>
          <Input
            type="email"
            autoComplete="email"
            value={value.personalEmail}
            onChange={(e) => {
              set({ personalEmail: e.target.value });
            }}
          />
        </FieldControl>
      </Field>
      <Field>
        <FieldLabel>{tr('components.details-form.mobile', 'Mobile')}</FieldLabel>
        <FieldControl>
          <PhoneField
            autoComplete="tel"
            label={tr('components.details-form.mobile', 'Mobile')}
            value={value.mobilePhone}
            onValueChange={(next) => {
              set({ mobilePhone: next });
            }}
          />
        </FieldControl>
      </Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">
          {tr('components.details-form.home_address', 'Home address')}
        </legend>
        <Field>
          <FieldLabel>{tr('components.details-form.country', 'Country')}</FieldLabel>
          <Select
            value={value.country}
            onValueChange={(next) => {
              set({ country: next, subdivision: '' });
            }}
          >
            <FieldControl>
              <SelectTrigger>
                <SelectValue
                  placeholder={tr('components.details-form.choose_a_country', 'Choose a country')}
                />
              </SelectTrigger>
            </FieldControl>
            <SelectContent>
              {COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>{tr('components.details-form.street', 'Street and number')}</FieldLabel>
          <FieldControl>
            <Input
              autoComplete="address-line1"
              value={value.line1}
              onChange={(e) => {
                set({ line1: e.target.value });
              }}
            />
          </FieldControl>
        </Field>
        <Field>
          <FieldLabel>
            {tr('components.details-form.line2', 'Flat, floor or building (optional)')}
          </FieldLabel>
          <FieldControl>
            <Input
              autoComplete="address-line2"
              value={value.line2}
              onChange={(e) => {
                set({ line2: e.target.value });
              }}
            />
          </FieldControl>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel>{tr('components.details-form.city', 'Town or city')}</FieldLabel>
            <FieldControl>
              <Input
                autoComplete="address-level2"
                value={value.city}
                onChange={(e) => {
                  set({ city: e.target.value });
                }}
              />
            </FieldControl>
          </Field>
          <Field>
            <FieldLabel>
              {rules?.postcodeLabel ?? tr('components.details-form.postcode', 'Postcode')}
            </FieldLabel>
            <FieldControl>
              <Input
                autoComplete="postal-code"
                placeholder={rules?.postcodeExample}
                value={value.postcode}
                onChange={(e) => {
                  set({ postcode: e.target.value });
                }}
              />
            </FieldControl>
          </Field>
        </div>
        {rules === undefined || rules.subdivisions.length === 0 ? null : (
          <Field>
            <FieldLabel>{rules.subdivisionLabel}</FieldLabel>
            <Select
              value={value.subdivision}
              onValueChange={(next) => {
                set({ subdivision: next });
              }}
            >
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {rules.subdivisions.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </fieldset>
    </div>
  );
}
