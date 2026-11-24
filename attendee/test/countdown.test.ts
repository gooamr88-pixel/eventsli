import { countdownParts } from '../src/lib/countdown';

test('splits a span into days, hours, minutes and seconds', () => {
  const ms = ((2 * 24 + 5) * 3600 + 7 * 60 + 9) * 1000 + 400;
  expect(countdownParts(ms)).toEqual({ days: 2, hours: 5, minutes: 7, seconds: 9 });
});

test('is null once the event has started, or for nonsense', () => {
  expect(countdownParts(0)).toBeNull();
  expect(countdownParts(-5000)).toBeNull();
  expect(countdownParts(Number.NaN)).toBeNull();
});
