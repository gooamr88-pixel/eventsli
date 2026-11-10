import { describe, test, expect } from 'vitest';
import { openCountryFor } from '../src/app/hooks/useOpenCountries';

/** A form holding a country an admin has closed moves to an open one. */
describe('openCountryFor', () => {
  const both = [['CA', 'Canada'], ['US', 'United States']];
  const usOnly = [['US', 'United States']];

  test('an open country is kept', () => {
    expect(openCountryFor('US', both)).toBe('US');
    expect(openCountryFor('CA', both)).toBe('CA');
  });

  test('a closed country moves to the first open one', () => {
    expect(openCountryFor('CA', usOnly)).toBe('US');
  });

  test('nothing open leaves nothing to move to', () => {
    expect(openCountryFor('CA', [])).toBeNull();
  });
});
