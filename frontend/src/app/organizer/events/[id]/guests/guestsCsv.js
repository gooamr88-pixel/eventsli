import { formatMoney } from '../../../../utils/money';

/**
 * One host's guests as CSV (2026-11-23). Quoted throughout, and a cell that
 * starts like a formula is prefixed so a spreadsheet shows it as text — a
 * guest's name is typed by the guest.
 */
function cell(value) {
  let v = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

export function guestsCsv(host, guests, currency) {
  const head = ['Guest of', 'Guest', 'Email', 'Phone', 'Tickets', 'Paid', 'Status', 'Booked'];
  const rows = guests.map((g) => [
    host.name, g.name, g.email || '', g.phone || '', g.tickets,
    formatMoney(g.totalCents, currency), g.status === 'paid' ? 'Confirmed' : 'Awaiting payment',
    g.bookedAt ? new Date(g.bookedAt).toISOString() : '',
  ]);
  return `${[head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
