import { whenRange } from '../src/lib/when';

// Local-time dates, as the phone sees them. 2026-11-25 is a Wednesday.
const wed = new Date(2026, 10, 25, 15, 30);

test('any time sends no range', () => {
  expect(whenRange('any', wed)).toEqual({});
});

test('today runs from now to the end of the day', () => {
  const r = whenRange('today', wed);
  expect(new Date(r.from!).getTime()).toBe(wed.getTime());
  const to = new Date(r.to!);
  expect([to.getDate(), to.getHours(), to.getMinutes()]).toEqual([25, 23, 59]);
});

test('this weekend on a Wednesday is Friday 00:00 to Sunday night', () => {
  const r = whenRange('weekend', wed);
  const from = new Date(r.from!);
  const to = new Date(r.to!);
  expect([from.getDay(), from.getDate(), from.getHours()]).toEqual([5, 27, 0]);
  expect([to.getDay(), to.getDate(), to.getHours()]).toEqual([0, 29, 23]);
});

test('this weekend on a Saturday starts now and still ends on Sunday', () => {
  const sat = new Date(2026, 10, 28, 20, 0);
  const r = whenRange('weekend', sat);
  expect(new Date(r.from!).getTime()).toBe(sat.getTime());
  expect(new Date(r.to!).getDate()).toBe(29);
});

test('this weekend on a Sunday keeps to that Sunday', () => {
  const sun = new Date(2026, 10, 29, 10, 0);
  const r = whenRange('weekend', sun);
  expect(new Date(r.from!).getTime()).toBe(sun.getTime());
  expect(new Date(r.to!).getDate()).toBe(29);
});

test('this week is seven days including today; this month ends on its last day', () => {
  expect(new Date(whenRange('week', wed).to!).getDate()).toBe(1); // Dec 1
  const m = new Date(whenRange('month', wed).to!);
  expect([m.getMonth(), m.getDate()]).toEqual([10, 30]);
});
