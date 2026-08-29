import { THEME_PRESETS } from '@kithena/contracts';
import { Badge } from '@reach/ui';
import type { JSX } from 'react';

/**
 * Choosing a company's accent, in the one place both screens read it from.
 *
 * Lifted out of the wizard when the edit form needed the same control. A second
 * copy would have been the cheaper change and the wrong one: the list of
 * presets, the contrast figure beside each and the sentence explaining why the
 * list is closed are all things that must not say different things on the
 * screen that sets a theme and the screen that changes it.
 */
export function ThemePicker({
  selected,
  onChange,
}: {
  selected: string;
  onChange: (id: string) => void;
}): JSX.Element {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-sm font-medium">Accent colour</legend>
      <p className="text-fg-muted text-sm">
        Re-points the accent on their sign-in page. Each of these carries white text at WCAG AA, so
        whichever is chosen stays legible.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {THEME_PRESETS.map((preset) => {
          const isSelected = preset.id === selected;
          return (
            <label
              key={preset.id}
              className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 transition ${
                isSelected ? 'border-accent bg-accent-subtle' : 'border-border hover:bg-surface'
              }`}
            >
              <input
                type="radio"
                name="theme"
                value={preset.id}
                checked={isSelected}
                className="sr-only"
                onChange={() => {
                  onChange(preset.id);
                }}
              />
              <span
                aria-hidden
                className="border-border size-9 shrink-0 rounded-full border"
                style={{ background: preset.accent }}
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium">{preset.name}</span>
                <span className="text-fg-muted text-xs">
                  {preset.contrastOnWhite.toFixed(1)}:1 on white
                </span>
              </span>
              {isSelected ? (
                <Badge tone="success" className="ml-auto">
                  Chosen
                </Badge>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
