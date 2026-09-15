/**
 * The dashboard periods, in days. The API accepts exactly these
 * (backend statsController WINDOWS); the organizer dashboard and the admin
 * overview each kept their own copy of the list.
 */
export const PERIODS = Object.freeze([
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
]);
