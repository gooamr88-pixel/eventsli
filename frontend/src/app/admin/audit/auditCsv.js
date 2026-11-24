import { get } from '../../utils/apiClient';
import { verbOf } from './AuditDetail';

/**
 * The audit log as a CSV file (2026-11-24), downloaded in the browser — the
 * copy to keep before clearing, or for an accountant. Read through the same
 * list endpoint the page uses, 200 at a time, up to 20,000 entries.
 * Returns how many entries it wrote.
 */
const PAGE = 200;
const MAX_PAGES = 100;

const cell = (v) => {
  const text = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export async function downloadAuditCsv({ until = null } = {}) {
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const qs = new URLSearchParams({ limit: String(PAGE), page: String(page) });
    if (until) qs.set('until', until);
    const body = await get(`/admin/audit?${qs}`, { raw: true, noRedirect: true, cache: 'no-store' });
    const data = body?.data || [];
    rows.push(...data);
    if (data.length < PAGE || page >= Number(body?.pagination?.totalPages || 1)) break;
  }

  const header = ['When (UTC)', 'Action', 'Action code', 'By', 'By email', 'Target type', 'Target id', 'Details'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.at, verbOf(r.action)[0], r.action, r.actor?.name || '', r.actor?.email || '',
      r.target?.type || '', r.target?.id || '', r.payload || {},
    ].map(cell).join(','));
  }

  // A BOM so spreadsheet apps read the file as UTF-8 (names, Arabic, emoji).
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `eventsli-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return rows.length;
}
