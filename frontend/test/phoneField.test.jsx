import { describe, test, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PhoneField from '../src/app/components/forms/PhoneField';
import { COUNTRIES, splitPhone, joinPhone, searchCountries, localeCountry, flagSrc } from '../src/app/lib/phoneInput';

/**
 * The phone field with its country (owner, 2026-11-19): a real flag and the
 * calling code, a searchable list, and one international value for the form.
 */
describe('phoneInput', () => {
  test('every country has its flag file', () => {
    const missing = COUNTRIES.filter((c) => !existsSync(join(__dirname, '..', 'public', flagSrc(c.iso))));
    expect(missing.map((c) => c.iso)).toEqual([]);
    expect(COUNTRIES.length).toBeGreaterThan(200);
  });

  test('joining: the trunk 0 is dropped, except where it belongs', () => {
    expect(joinPhone('EG', '0100 123 4567')).toBe('+20 100 123 4567');
    expect(joinPhone('GB', '07700 900123')).toBe('+44 7700 900123');
    expect(joinPhone('IT', '06 1234 5678')).toBe('+39 06 1234 5678');
    expect(joinPhone('US', '')).toBe('');
    expect(joinPhone('US', 'call me')).toBe('');
  });

  test('splitting: shared codes are told apart, a chosen country is kept', () => {
    expect(splitPhone('+20 100 123 4567')).toEqual({ iso: 'EG', national: '100 123 4567' });
    expect(splitPhone('+1 416 555 0199').iso).toBe('CA');
    expect(splitPhone('+1 212 555 0199').iso).toBe('US');
    expect(splitPhone('+7 701 000 0000').iso).toBe('KZ');
    expect(splitPhone('+1 212 555 0199', 'JM').iso).toBe('JM');
    expect(splitPhone('0100', 'EG')).toEqual({ iso: 'EG', national: '0100' });
  });

  test('search by name, code or calling code', () => {
    expect(searchCountries('egy').map((c) => c.iso)).toEqual(['EG']);
    expect(searchCountries('+20').some((c) => c.iso === 'EG')).toBe(true);
    expect(searchCountries('eg').some((c) => c.iso === 'EG')).toBe(true);
    expect(searchCountries('zzzz')).toEqual([]);
  });

  test('the browser\'s region picks the starting country', () => {
    expect(localeCountry(['ar-EG', 'en'])).toBe('EG');
    expect(localeCountry(['en'])).toBeNull();
  });
});

function Harness({ initial = '', defaultCountry = null }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <PhoneField label="Phone" value={v} onChange={setV} defaultCountry={defaultCountry} />
      <output data-testid="value">{v}</output>
    </>
  );
}

describe('PhoneField', () => {
  test('starts on the given country, and the form gets an international number', () => {
    render(<Harness defaultCountry="EG" />);
    expect(screen.getByRole('button', { name: /Country: Egypt, \+20/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '0100 123 4567' } });
    expect(screen.getByTestId('value')).toHaveTextContent('+20 100 123 4567');
  });

  test('choosing a country from the searchable list', async () => {
    const user = userEvent.setup();
    render(<Harness defaultCountry="EG" />);
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '7700 900123' } });
    await user.click(screen.getByRole('button', { name: /Country: Egypt/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Search countries' }), 'united kingdom');
    await user.click(screen.getByRole('option', { name: /United Kingdom/ }));
    expect(screen.getByTestId('value')).toHaveTextContent('+44 7700 900123');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  test('a saved international value opens on its own country', () => {
    // A London number (+44 7700 … would be Jersey: it is in Jersey's prefixes).
    render(<Harness initial="+44 20 7946 0958" defaultCountry="EG" />);
    expect(screen.getByRole('button', { name: /Country: United Kingdom, \+44/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toHaveValue('20 7946 0958');
  });
});
