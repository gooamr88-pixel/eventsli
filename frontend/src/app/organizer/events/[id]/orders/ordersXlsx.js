import { currencySymbol, minorUnits } from '../../../../lib/markets';
import {
  fetchAllOrders, summarize, describeFilters, eventLine, channelText, orderRef, toUnits, fileBase, saveBlob,
  addonsText, STATUS_LABELS,
} from './ordersExport';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDERS AS AN EXCEL WORKBOOK (2026-11-23). Two sheets:
 *
 *   Summary  the brand band, the event, the filters it was cut under, and per
 *            currency the KPI tiles and the money from ticket sales down to
 *            what the organizer keeps.
 *   Orders   one row per order — real dates on the event's clock (sortable,
 *            not text), money as numbers in the order's own currency format,
 *            header frozen and filterable, and totals rows that are LIVE
 *            formulas, so an organizer who deletes a test order sees the
 *            total move.
 *
 * exceljs is passed IN rather than imported here: the browser loads it only on
 * the click (`downloadOrdersXlsx`), and the test builds the same workbook in
 * Node and reads it back cell by cell.
 *
 * Text is written as text — an xlsx cell is a formula only when it is given
 * one — so a buyer named "=HYPERLINK(…)" is a name here, not the injection it
 * is in a CSV.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const C = {
  ink: 'FF15141C', white: 'FFFFFFFF', coral: 'FFD61F2C', coralWash: 'FFFFF1F2', coralDeep: 'FFB5121E',
  sun: 'FFFFCC00', muted: 'FF6B6A7A', line: 'FFE6E5EC', zebra: 'FFFAFAFB', paleInk: 'FFF3F3F6',
};
const FONT = 'Calibri';
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const hair = (argb = C.line) => ({ style: 'thin', color: { argb } });

/** `"CA$"#,##0.00` — the currency's symbol and its own number of decimals. */
export function moneyFormat(currency) {
  const sym = (currencySymbol(currency) || `${currency} `).replace(/"/g, '');
  const dec = minorUnits(currency);
  const n = `#,##0${dec ? `.${'0'.repeat(dec)}` : ''}`;
  return `"${sym}"${n};-"${sym}"${n}`;
}

/**
 * The moment as the event's wall clock, for Excel — which stores a date with
 * no zone at all. 20:00 in Toronto is written as 20:00, and the column header
 * names the zone, rather than every time shifting by the organizer's offset.
 */
export function wallClock(iso, timeZone) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(d).map((p) => [p.type, p.value]));
    return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second));
  } catch {
    return d;
  }
}

const colLetter = (n) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

/** The Orders sheet's columns. Optional ones appear only when some row uses them. */
function orderColumns(rows, timezone) {
  const any = (fn) => rows.some(fn);
  return [
    { key: 'n', header: '#', width: 6, type: 'int', value: (_, i) => i + 1 },
    { key: 'ref', header: 'Order', width: 12, value: (o) => orderRef(o) },
    { key: 'when', header: `Date (${timezone || 'UTC'})`, width: 19, type: 'date', value: (o) => wallClock(o.paidAt || o.createdAt, timezone) },
    { key: 'name', header: 'Buyer', width: 26, value: (o) => o.buyer?.name || 'No name given' },
    { key: 'email', header: 'Email', width: 32, value: (o) => o.buyer?.email || '' },
    ...(any((o) => o.buyer?.phone) ? [{ key: 'phone', header: 'Phone', width: 18, value: (o) => o.buyer?.phone || '' }] : []),
    { key: 'account', header: 'Account', width: 10, value: (o) => (o.buyer?.hasAccount ? 'Yes' : 'Guest') },
    { key: 'channel', header: 'Channel', width: 18, value: channelText },
    { key: 'status', header: 'Status', width: 12, value: (o) => STATUS_LABELS[o.status] || o.status },
    ...(any((o) => o.guestOf) ? [{ key: 'guestOf', header: 'Guest of', width: 18, value: (o) => o.guestOf?.name || '' }] : []),
    { key: 'tickets', header: 'Tickets', width: 9, type: 'int', sum: true, value: (o) => Number(o.tickets) || 0 },
    ...(any((o) => o.addons?.length) ? [{ key: 'addons', header: 'Add-ons', width: 30, value: addonsText }] : []),
    { key: 'currency', header: 'Currency', width: 10, value: (o) => o.currency },
    { key: 'subtotal', header: 'Ticket sales', width: 14, type: 'money', sum: true, value: (o) => o.subtotalCents },
    ...(any((o) => o.discountCents) ? [{ key: 'discount', header: 'Discount', width: 13, type: 'money', sum: true, value: (o) => -Math.abs(o.discountCents || 0) }] : []),
    ...(any((o) => o.taxCents) ? [{ key: 'tax', header: 'Tax', width: 12, type: 'money', sum: true, value: (o) => o.taxCents }] : []),
    { key: 'paid', header: 'Buyer paid', width: 14, type: 'money', sum: true, strong: true, value: (o) => o.buyerPaidCents },
    { key: 'commission', header: 'Commission', width: 13, type: 'money', sum: true, value: (o) => -Math.abs(o.commissionCents || 0) },
    { key: 'net', header: 'To you', width: 14, type: 'money', sum: true, strong: true, value: (o) => o.organizerNetCents },
    ...(any((o) => o.signed !== undefined) ? [{ key: 'signed', header: 'Signed', width: 9, value: (o) => (o.signed ? 'Yes' : '—') }] : []),
    ...(any((o) => o.manual?.note) ? [{ key: 'note', header: 'Door note', width: 28, value: (o) => o.manual?.note || '' }] : []),
  ];
}

/** The black band with the wordmark across a sheet's first row. */
function brandBand(ws, lastCol, right) {
  ws.mergeCells(1, 1, 1, Math.max(2, lastCol - 2));
  ws.mergeCells(1, Math.max(3, lastCol - 1), 1, lastCol);
  const logo = ws.getCell(1, 1);
  logo.value = { richText: [
    { text: 'events', font: { name: FONT, bold: true, size: 20, color: { argb: C.white } } },
    { text: 'li', font: { name: FONT, bold: true, size: 20, color: { argb: C.sun } } },
  ] };
  logo.alignment = { vertical: 'middle', indent: 1 };
  const tag = ws.getCell(1, Math.max(3, lastCol - 1));
  tag.value = right;
  tag.font = { name: FONT, bold: true, size: 10, color: { argb: C.sun } };
  tag.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
  for (let c = 1; c <= lastCol; c += 1) {
    ws.getCell(1, c).fill = fill(C.ink);
    ws.getCell(2, c).fill = fill(C.coral);
  }
  ws.getRow(1).height = 36;
  ws.getRow(2).height = 4;
}

function line(ws, row, lastCol, value, font) {
  ws.mergeCells(row, 1, row, lastCol);
  const cell = ws.getCell(row, 1);
  cell.value = value;
  cell.font = { name: FONT, ...font };
  cell.alignment = { vertical: 'middle', wrapText: true };
}

function summarySheet(wb, { event, summary, filters, generated, timezone }) {
  const ws = wb.addWorksheet('Summary', {
    properties: { tabColor: { argb: C.coral } },
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const LAST = 6;
  ws.columns = Array.from({ length: LAST }, () => ({ width: 19 }));
  brandBand(ws, LAST, 'SALES REPORT');

  line(ws, 4, LAST, event?.title || 'Event', { bold: true, size: 20, color: { argb: C.ink } });
  ws.getRow(4).height = 30;
  line(ws, 5, LAST, eventLine(event) || '—', { size: 11, color: { argb: C.muted } });
  line(ws, 6, LAST, `Orders: ${describeFilters(filters).join(' · ')}`, { size: 11, color: { argb: C.muted } });
  line(ws, 7, LAST, `Generated ${generated} (${timezone || 'UTC'})`, { size: 9, italic: true, color: { argb: C.muted } });

  let r = 9;
  if (!summary.length) {
    line(ws, r, LAST, 'No orders match these filters.', { size: 12, color: { argb: C.muted } });
    return ws;
  }

  for (const s of summary) {
    const money = moneyFormat(s.currency);
    // Section heading, ruled in coral.
    line(ws, r, LAST, `Sales in ${s.currency}`, { bold: true, size: 13, color: { argb: C.ink } });
    for (let c = 1; c <= LAST; c += 1) ws.getCell(r, c).border = { bottom: { style: 'medium', color: { argb: C.coral } } };
    ws.getRow(r).height = 22;
    r += 2;

    // KPI tiles: Sales and To you two columns wide, Orders and Tickets one.
    const tiles = [
      { from: 1, to: 2, label: 'SALES · WHAT BUYERS PAID', value: toUnits(s.grossCents, s.currency), fmt: money },
      { from: 3, to: 4, label: 'TO YOU · AFTER COMMISSION', value: toUnits(s.netCents, s.currency), fmt: money, accent: true },
      { from: 5, to: 5, label: 'ORDERS', value: s.orders, fmt: '#,##0' },
      { from: 6, to: 6, label: 'TICKETS', value: s.tickets, fmt: '#,##0' },
    ];
    for (const t of tiles) {
      if (t.to > t.from) { ws.mergeCells(r, t.from, r, t.to); ws.mergeCells(r + 1, t.from, r + 1, t.to); }
      const label = ws.getCell(r, t.from);
      label.value = t.label;
      label.font = { name: FONT, bold: true, size: 8, color: { argb: t.accent ? C.coralDeep : C.muted } };
      label.alignment = { vertical: 'bottom', indent: 1 };
      const value = ws.getCell(r + 1, t.from);
      value.value = t.value;
      value.numFmt = t.fmt;
      value.font = { name: FONT, bold: true, size: 18, color: { argb: t.accent ? C.coral : C.ink } };
      value.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      for (let c = t.from; c <= t.to; c += 1) {
        for (const row of [r, r + 1]) {
          ws.getCell(row, c).fill = fill(t.accent ? C.coralWash : C.paleInk);
          ws.getCell(row, c).border = {
            left: c === t.from ? { style: 'thick', color: { argb: C.white } } : undefined,
            right: c === t.to ? { style: 'thick', color: { argb: C.white } } : undefined,
          };
        }
      }
    }
    ws.getRow(r).height = 20;
    ws.getRow(r + 1).height = 32;
    r += 3;

    // The money, top to bottom.
    const breakdown = [
      ['Ticket sales', s.subtotalCents],
      ...(s.discountCents ? [['Discounts', -Math.abs(s.discountCents)]] : []),
      ...(s.taxCents ? [['Tax collected', s.taxCents]] : []),
      ['Buyers paid', s.grossCents, 'total'],
      ['Eventsli commission', -Math.abs(s.commissionCents)],
      ['To you', s.netCents, 'net'],
      null,
      [`Card · ${s.card} ${s.card === 1 ? 'order' : 'orders'}`, s.cardCents],
      [`At the door · ${s.door} ${s.door === 1 ? 'order' : 'orders'}`, s.doorCents],
    ];
    for (const item of breakdown) {
      if (!item) { r += 1; continue; }
      const [label, cents, kind] = item;
      ws.mergeCells(r, 1, r, 4);
      ws.mergeCells(r, 5, r, 6);
      const l = ws.getCell(r, 1);
      const v = ws.getCell(r, 5);
      l.value = label;
      v.value = toUnits(cents, s.currency);
      v.numFmt = money;
      v.alignment = { horizontal: 'right', indent: 1 };
      l.alignment = { indent: 1 };
      const strong = kind === 'total' || kind === 'net';
      l.font = { name: FONT, size: 11, bold: strong, color: { argb: kind === 'net' ? C.coralDeep : C.ink } };
      v.font = { name: FONT, size: 11, bold: strong, color: { argb: kind === 'net' ? C.coralDeep : C.ink } };
      for (let c = 1; c <= LAST; c += 1) {
        const cell = ws.getCell(r, c);
        cell.border = { bottom: hair(), ...(kind === 'total' ? { top: hair(C.ink) } : {}) };
        if (kind === 'net') cell.fill = fill(C.coralWash);
      }
      ws.getRow(r).height = 20;
      r += 1;
    }
    r += 2;
  }

  line(ws, r, LAST, 'Totals are for every order under the filters above, not only one page of them. “To you” is what you keep: card sales arrive with commission already taken; door sales owe it.', { size: 9, italic: true, color: { argb: C.muted } });
  ws.getRow(r).height = 30;
  return ws;
}

function ordersSheet(wb, { event, rows, filters, generated, timezone, summary }) {
  const cols = orderColumns(rows, timezone);
  const LAST = cols.length;
  const HEAD = 4;
  const ws = wb.addWorksheet('Orders', {
    properties: { tabColor: { argb: C.ink } },
    views: [{ state: 'frozen', ySplit: HEAD, xSplit: 4, showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: `${HEAD}:${HEAD}`, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
    },
    headerFooter: {
      oddFooter: `&L&8Eventsli · Orders · ${String(event?.title || '').replace(/&/g, '&&')}&R&8Page &P of &N`,
    },
  });
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));
  brandBand(ws, LAST, 'ORDERS');
  line(ws, 3, LAST, [event?.title, eventLine(event), describeFilters(filters).join(' · '), `Generated ${generated}`].filter(Boolean).join('   ·   '), { size: 10, color: { argb: C.muted } });
  ws.getRow(3).height = 22;

  const head = ws.getRow(HEAD);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, bold: true, size: 10, color: { argb: C.white } };
    cell.fill = fill(C.coral);
    cell.alignment = { vertical: 'middle', horizontal: c.type === 'money' || c.type === 'int' ? 'right' : 'left', indent: c.type ? 0 : 1 };
    cell.border = { bottom: { style: 'medium', color: { argb: C.coralDeep } } };
  });
  head.height = 26;

  rows.forEach((o, i) => {
    const row = ws.getRow(HEAD + 1 + i);
    const money = moneyFormat(o.currency);
    cols.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      const raw = c.value(o, i);
      cell.value = c.type === 'money' ? toUnits(raw, o.currency) : raw;
      if (c.type === 'money') cell.numFmt = money;
      if (c.type === 'date') cell.numFmt = 'dd mmm yyyy  hh:mm';
      if (c.type === 'int') cell.numFmt = '#,##0';
      cell.font = { name: FONT, size: 10, bold: !!c.strong, color: { argb: c.key === 'net' ? C.coralDeep : c.key === 'email' || c.key === 'n' ? C.muted : C.ink } };
      cell.alignment = { vertical: 'middle', horizontal: c.type === 'money' || c.type === 'int' ? 'right' : 'left', indent: c.type ? 0 : 1 };
      cell.border = { bottom: hair() };
      if (i % 2 === 1) cell.fill = fill(C.zebra);
    });
    row.height = 20;
  });

  // Totals, one row per currency, as live SUMIFS over the Currency column.
  const first = HEAD + 1;
  const last = HEAD + rows.length;
  const curCol = colLetter(cols.findIndex((c) => c.key === 'currency') + 1);
  let r = last + 2;
  for (const s of summary) {
    const row = ws.getRow(r);
    const labelCell = row.getCell(4);
    labelCell.value = `Total · ${s.currency} · ${s.orders} ${s.orders === 1 ? 'order' : 'orders'}`;
    cols.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      if (c.sum && rows.length) {
        const col = colLetter(j + 1);
        const result = rows.filter((o) => o.currency === s.currency)
          .reduce((t, o, k) => t + (c.type === 'money' ? toUnits(c.value(o, k), o.currency) : Number(c.value(o, k)) || 0), 0);
        cell.value = { formula: `SUMIFS(${col}${first}:${col}${last},${curCol}${first}:${curCol}${last},"${s.currency}")`, result };
        cell.numFmt = c.type === 'money' ? moneyFormat(s.currency) : '#,##0';
        cell.alignment = { horizontal: 'right' };
      }
      cell.font = { name: FONT, size: 11, bold: true, color: { argb: c.key === 'net' ? C.coral : C.white } };
      cell.fill = fill(C.ink);
      if (j === 3) cell.alignment = { indent: 1 };
    });
    row.height = 24;
    r += 1;
  }

  if (rows.length) ws.autoFilter = { from: { row: HEAD, column: 1 }, to: { row: last, column: LAST } };
  return ws;
}

/** The whole workbook, built with the exceljs it is given. */
export function buildOrdersWorkbook(ExcelJS, { event, rows, meta, filters, now = new Date() }) {
  const timezone = event?.timezone || 'UTC';
  const generated = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, dateStyle: 'medium', timeStyle: 'short',
  }).format(now);
  const summary = summarize(rows, meta);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Eventsli';
  wb.company = 'Eventsli';
  wb.title = `Orders · ${event?.title || 'Event'}`;
  wb.created = now;
  wb.modified = now;
  const ctx = { event, rows, filters, generated, timezone, summary };
  summarySheet(wb, ctx);
  ordersSheet(wb, ctx);
  return wb;
}

/** Fetches every matching order and saves the workbook. Resolves to the count. */
export async function downloadOrdersXlsx({ eventId, event, filters }) {
  const [{ rows, meta }, mod] = await Promise.all([fetchAllOrders(eventId, filters), import('exceljs')]);
  const ExcelJS = mod.default || mod;
  const wb = buildOrdersWorkbook(ExcelJS, { event, rows, meta, filters });
  const buffer = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${fileBase(event)}.xlsx`,
  );
  return rows.length;
}
