import { icons, type AccessAudience, type AccessValue } from '@reach/ui';
import type { JSX } from 'react';

import type { DataType, ViewerScope, WriterRole } from './model';

/**
 * Who may see and change a field, as Reach's access matrix draws it: one row
 * per audience People knows, in the order a reader thinks of them, from the
 * person themselves out to everybody in the directory.
 */
export const AUDIENCES: readonly AccessAudience[] = [
  {
    id: 'self',
    label: 'The employee',
    description: 'The person it’s about',
    icon: <icons.person />,
  },
  { id: 'manager', label: 'Their manager', description: 'Direct manager', icon: <icons.team /> },
  {
    id: 'manager_chain',
    label: 'Managers above',
    description: 'Up to the top',
    icon: <icons.organisation />,
  },
  { id: 'hr', label: 'HR', description: 'Your HR team', icon: <icons.people /> },
  { id: 'finance', label: 'Finance', description: 'For payroll', icon: <icons.payroll /> },
  {
    id: 'directory',
    label: 'Everyone',
    description: 'In the directory',
    icon: <icons.visible />,
    canChange: false,
  },
];

const WRITER_AUDIENCE: Partial<Record<WriterRole, string>> = {
  employee: 'self',
  manager: 'manager',
  hr: 'hr',
  finance: 'finance',
};

const AUDIENCE_WRITER: Record<string, WriterRole> = {
  self: 'employee',
  manager: 'manager',
  hr: 'hr',
  finance: 'finance',
};

/** A field's visibility and ownership as the matrix's value. */
export function accessOf(
  visibility: readonly ViewerScope[],
  ownership: readonly WriterRole[],
): AccessValue {
  return {
    see: visibility.filter((s) => s !== 'admin'),
    change: ownership.flatMap((w) => {
      const id = WRITER_AUDIENCE[w];
      return id === undefined ? [] : [id];
    }),
  };
}

/** The matrix's value back as scopes and writers; an admin keeps what it had. */
export function fromAccess(
  value: AccessValue,
  was: { readonly visibility: readonly ViewerScope[]; readonly ownership: readonly WriterRole[] },
): { visibility: ViewerScope[]; ownership: WriterRole[] } {
  const seen = new Set([...value.see, ...value.change]);
  return {
    visibility: [
      ...AUDIENCES.map((a) => a.id as ViewerScope).filter((s) => seen.has(s)),
      ...was.visibility.filter((s) => s === 'admin'),
    ],
    ownership: [
      ...value.change.flatMap((id) => {
        const w = AUDIENCE_WRITER[id];
        return w === undefined ? [] : [w];
      }),
      ...was.ownership.filter((w) => w === 'system' || w === 'external'),
    ],
  };
}

/** A glyph for the kind of answer a field takes. */
export function TypeIcon({ dataType }: { readonly dataType: DataType }): JSX.Element {
  switch (dataType) {
    case 'date':
    case 'datetime':
    case 'duration':
      return <icons.calendar aria-hidden />;
    case 'email':
      return <icons.email aria-hidden />;
    case 'phone':
      return <icons.phone aria-hidden />;
    case 'money':
    case 'currency':
      return <icons.payroll aria-hidden />;
    case 'bank_account':
      return <icons.payment aria-hidden />;
    case 'national_id':
      return <icons.identifier aria-hidden />;
    case 'person_ref':
      return <icons.person aria-hidden />;
    case 'org_unit_ref':
    case 'legal_entity_ref':
      return <icons.organisation aria-hidden />;
    case 'location_ref':
    case 'address':
    case 'country':
      return <icons.location aria-hidden />;
    case 'document_ref':
    case 'image':
      return <icons.file aria-hidden />;
    case 'select':
    case 'multi_select':
    case 'tags':
      return <icons.tag aria-hidden />;
    case 'boolean':
      return <icons.confirm aria-hidden />;
    default:
      return <icons.document aria-hidden />;
  }
}
