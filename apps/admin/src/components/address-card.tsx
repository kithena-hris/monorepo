import { Alert, icons } from '@reach/ui';
import type { JSX } from 'react';

import { describeCondition, type Place } from '../lib/place';
import { LocalClock } from './local-clock';
import { Sky } from './sky';

const LocationIcon = icons.location;

/**
 * Where a company is, with the sky over it.
 *
 * The weather belongs here rather than on a figures tile, because this is the
 * card about the place — and the two together answer a question an operator
 * actually has. Reading a ticket from a customer, "23:40 there, dark" is the
 * difference between "why has nobody replied" and "of course nobody has
 * replied", and a timezone name is not that answer until you have converted it.
 *
 * The band carries no text. Everything is written underneath on the card's own
 * surface, which is what lets the sky be the blue a sky actually is and what
 * makes this correct in both themes without a second palette: the caption is
 * ordinary `text-fg` on `bg-surface`, not white on a picture.
 *
 * Without a place — no address recorded, the lookup switched off, or the
 * service down — there is no band and the card is the address alone. Nothing
 * here is load-bearing.
 */
export function AddressCard({
  addressLines,
  place,
}: {
  readonly addressLines: readonly string[];
  readonly place: Place | null;
}): JSX.Element {
  return (
    <section
      aria-labelledby="address-heading"
      className="border-border bg-surface overflow-hidden rounded-lg border"
    >
      {place === null ? null : <Sky condition={place.condition} isDay={place.isDay} className="h-28 sm:h-32" />}

      <div className="p-4 sm:p-5">
        <h2 id="address-heading" className="text-md text-fg flex items-center gap-2 font-semibold">
          <LocationIcon aria-hidden className="text-fg-muted size-4" />
          Registered address
        </h2>

        {addressLines.length === 0 ? (
          <p className="text-fg-muted mt-2 text-sm">
            None recorded. This company was created before an address was asked for.
          </p>
        ) : (
          <address className="text-fg-muted mt-2 text-sm not-italic">
            {addressLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        )}

        {place === null ? null : (
          <dl className="border-border mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t pt-4">
            <div className="flex items-baseline gap-2">
              <dt className="sr-only">Temperature</dt>
              <dd className="text-fg text-2xl font-semibold tabular-nums">
                {Math.round(place.temperatureC)}°
              </dd>
              <dt className="sr-only">Conditions</dt>
              <dd className="text-fg-muted text-sm">
                {describeCondition(place.condition, place.isDay)}
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-fg-muted text-sm">Local time</dt>
              <dd className="text-fg text-sm font-medium tabular-nums">
                {/*
                  The server value is the initial state, so the hydrated markup
                  matches what was sent and the clock then keeps itself right.
                */}
                <LocalClock
                  timeZone={place.timeZone}
                  initial={new Date().toLocaleTimeString('en-GB', {
                    timeZone: place.timeZone,
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                />
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-fg-muted text-sm">In</dt>
              <dd className="text-fg text-sm font-medium">
                {place.city}, {place.country}
              </dd>
            </div>
          </dl>
        )}

        {place === null || addressLines.length > 0 ? null : (
          <Alert tone="info" title="No address" className="mt-4">
            Add one from Edit, and this card shows the local time and weather there.
          </Alert>
        )}
      </div>
    </section>
  );
}
