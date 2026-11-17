'use client';

import { SelectField } from '../../../components/forms/Field';
import { thisMonth } from '../../../lib/comingSoon';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** How many years ahead a teaser can be announced. */
const YEARS_AHEAD = 3;

/**
 * A coming-soon event's rough date: a month and a year, nothing finer
 * (lib/comingSoon.js). Two selects rather than `<input type="month">`, which
 * Safari and Firefox on the desktop still render as a plain text box.
 *
 * Shared by the coming-soon form and Event details, so both ask the same
 * question the same way. `value` is `'YYYY-MM'`, or '' when not chosen.
 */
export default function MonthFields({ value, timezone, onChange, error = null, hint = null }) {
  const earliest = thisMonth(timezone);
  const [minYear, minMonth] = earliest.split('-').map(Number);
  const [year, month] = (value || '').split('-');
  const years = Array.from({ length: YEARS_AHEAD + 1 }, (_, i) => String(minYear + i));
  // A saved month already in the past stays selectable, so the form can show it.
  if (year && !years.includes(year)) years.unshift(year);

  // A year with no month yet is kept as `'YYYY-'`, so picking the year first
  // does not snap back. Only a full `'YYYY-MM'` is a month (monthRange).
  const emit = (y, m) => onChange(y ? `${y}-${m || ''}` : '');

  return (
    <div className="fx-grid fx-grid--2">
      <SelectField
        label="Month" name="month" required value={month || ''}
        error={error}
        hint={hint}
        onChange={(e) => emit(year || String(minYear), e.target.value)}
        options={[
          ['', 'Choose a month'],
          ...MONTHS.map((name, i) => {
            const mm = String(i + 1).padStart(2, '0');
            return [mm, name];
          }).filter(([mm]) => Number(year || minYear) > minYear || Number(mm) >= minMonth || mm === month),
        ]}
      />
      <SelectField
        label="Year" name="year" required value={year || String(minYear)}
        onChange={(e) => {
          const y = e.target.value;
          // Moving to this year from a later one: a month already gone is cleared.
          const keep = month && (Number(y) > minYear || Number(month) >= minMonth);
          emit(y, keep ? month : '');
        }}
        options={years.map((y) => [y, y])}
      />
    </div>
  );
}
