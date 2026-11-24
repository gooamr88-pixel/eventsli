/**
 * Explore's "When" filter, as the from/to the API takes (ISO 8601, compared
 * with the event's start).
 *
 * On the PHONE'S calendar, not the event's: "Today" means the day the person
 * is living in, and an event elsewhere that starts during it is today to
 * them. Each range starts now (not at midnight) so an event that already
 * began this morning is not offered as something still to go to.
 */
export type When = 'any' | 'today' | 'weekend' | 'week' | 'month';

export const WHEN_OPTIONS: { value: When; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'weekend', label: 'This weekend' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
];

const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());

export function whenRange(when: When, now: Date = new Date()): { from?: string; to?: string } {
  if (when === 'any') return {};
  let from = now;
  let to: Date;
  if (when === 'today') {
    to = endOfDay(now);
  } else if (when === 'week') {
    to = endOfDay(addDays(now, 6));
  } else if (when === 'month') {
    to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else {
    // Friday to Sunday, which covers a Friday–Saturday weekend and a
    // Saturday–Sunday one alike. Inside it, from now; before it, from Friday.
    const day = now.getDay(); // 0 Sunday … 6 Saturday
    const toFriday = day === 0 ? -2 : day === 6 ? -1 : 5 - day;
    const friday = startOfDay(addDays(now, toFriday));
    from = friday > now ? friday : now;
    to = endOfDay(addDays(friday, 2));
  }
  return { from: from.toISOString(), to: to.toISOString() };
}
