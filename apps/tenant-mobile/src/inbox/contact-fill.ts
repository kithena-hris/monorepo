/**
 * A contact from the phone, poured into the fields a task asks for (design v3
 * I2): the name into the field named like a name, the number into the phone
 * field, the address into the email field. Pure, so it is tested without a phone.
 */

export interface AskedField {
  readonly key: string;
  readonly label: string;
  readonly dataType: string;
}

export interface PickedContact {
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
}

/** Whether a task's fields are the kind a contact fills: a phone number, and somewhere for a name. */
export const contactShaped = (fields: readonly AskedField[]): boolean =>
  fields.some((f) => f.dataType === 'phone') &&
  fields.some((f) => f.dataType === 'text' && /name|contact/iu.test(`${f.key} ${f.label}`));

export function valuesFrom(
  fields: readonly AskedField[],
  contact: PickedContact,
): Record<string, string> {
  const out: Record<string, string> = {};
  const name = fields.find(
    (f) => f.dataType === 'text' && /name|contact/iu.test(`${f.key} ${f.label}`),
  );
  const phone = fields.find((f) => f.dataType === 'phone');
  const email = fields.find((f) => f.dataType === 'email');
  if (name !== undefined && contact.name !== '') out[name.key] = contact.name;
  if (phone !== undefined && contact.phone !== null)
    out[phone.key] = contact.phone.replace(/[^\d+]/gu, '');
  if (email !== undefined && contact.email !== null) out[email.key] = contact.email;
  return out;
}
