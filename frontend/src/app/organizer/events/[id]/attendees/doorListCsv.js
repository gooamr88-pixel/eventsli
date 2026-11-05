import { get } from '../../../../utils/apiClient';
import { formatEventTime } from '../../../../lib/eventTime';

/**
 * The door list as a CSV, built in the browser from the same endpoint the page
 * reads — every page of it, under the filter and search on screen.
 *
 * There is no export endpoint, and this needs none: the list carries no entry
 * codes (see Attendees.jsx), so a file of it gives away nothing the screen does
 * not. 200 rows a request is the API's ceiling (middleware/pagination.js).
 *
 * A cell starting with = + - or @ is prefixed with an apostrophe. A guest
 * named "=HYPERLINK(...)" is otherwise a formula the moment the organizer
 * opens the file in a spreadsheet.
 */
const PAGE = 200;

export async function fetchDoorList(eventId, filters) {
  const rows = [];
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({ limit: String(PAGE), page: String(page) });
    if (filters.checkedIn) query.set('checkedIn', filters.checkedIn);
    if (filters.search) query.set('q', filters.search);
    const body = await get(`/events/${eventId}/attendees?${query}`, { cache: 'no-store', raw: true, noRedirect: true });
    rows.push(...(body?.data || []));
    if (page >= (body?.pagination?.totalPages || 1)) return rows;
  }
}

export function doorListCsv(rows, timezone) {
  const head = ['Name', 'Email', 'Table', 'Seat', 'Ticket', 'At the door', 'Checked in at'];
  const lines = rows.map((a) => [
    a.name || '',
    a.email || '',
    a.table || '',
    a.seat || '',
    a.tier || (a.channel === 'manual' ? 'Door sale' : ''),
    a.checkedIn ? 'In' : a.status === 'void' ? 'Void' : 'Not yet',
    a.checkedInAt ? formatEventTime(a.checkedInAt, timezone) : '',
  ]);
  return [head, ...lines].map((cells) => cells.map(cell).join(',')).join('\r\n');
}

function cell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Hands the browser a file. A BOM first, so Excel reads accented names as UTF-8. */
export function saveCsv(text, filename) {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
