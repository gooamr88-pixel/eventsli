import { distanceText, rounded } from '../src/lib/location';

test('a position leaves the phone rounded to about a kilometre', () => {
  expect(rounded({ lat: 30.044420, lng: 31.235712 })).toEqual({ lat: 30.04, lng: 31.24 });
});

test('distances read the way people say them', () => {
  expect(distanceText(0.04)).toBe('100 m away');
  expect(distanceText(0.83)).toBe('800 m away');
  expect(distanceText(3.44)).toBe('3.4 km away');
  expect(distanceText(27.6)).toBe('28 km away');
  expect(distanceText(undefined)).toBe('');
});
