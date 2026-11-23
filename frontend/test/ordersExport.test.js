// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';

vi.mock('../src/app/utils/apiClient', () => ({ get: vi.fn() }));

import { get } from '../src/app/utils/apiClient';
import {
  fetchAllOrders, summarize, describeFilters, channelText, orderRef, toUnits, fileBase,
} from '../src/app/organizer/events/[id]/orders/ordersExport';
import { buildOrdersWorkbook, moneyFormat, wallClock } from '../src/app/organizer/events/[id]/orders/ordersXlsx';

const event = {
  title: 'Ladies Night & Friends', slug: 'ladies-night', timezone: 'America/Toronto',
  startsAt: '2026-12-20T01:00:00Z', venue: 'The Hall', city: 'Toronto', currency: 'CAD',
};

const order = (over = {}) => ({
  id: 'a1b2c3d4-0000-4000-8000-000000000000', channel: 'stripe', status: 'paid', currency: 'CAD', tickets: 2,
  buyer: { name: 'Sara Ahmed', email: 'sara@example.com', hasAccount: true }, guestOf: null,
  subtotalCents: 10000, discountCents: 0, taxCents: 1300, buyerPaidCents: 11300,
  commissionCents: 500, organizerNetCents: 10800, manual: null,
  createdAt: '2026-11-20T23:30:00Z', paidAt: '2026-11-20T23:31:00Z', signed: true,
  ...over,
});

const rows = [
  order({ addons: [{ addonId: 'p', name: 'Photo with the star', quantity: 2, unitPriceCents: 2000, amountCents: 4000 }] }),
  order({
    id: 'ffff0000-0000-4000-8000-000000000000', channel: 'manual', tickets: 1,
    buyer: { name: '=HYPERLINK("http://x")', email: null, hasAccount: false },
    subtotalCents: 5000, discountCents: 1000, taxCents: 0, buyerPaidCents: 4000, commissionCents: 200,
    organizerNetCents: 3800, manual: { method: 'cash', note: 'Paid at table 4' }, guestOf: { id: 'h', name: 'The bride' },
  }),
  order({ id: '99990000-0000-4000-8000-000000000000', currency: 'USD', buyerPaidCents: 2000, subtotalCents: 2000, taxCents: 0, organizerNetCents: 1900, commissionCents: 100, tickets: 1 }),
];

describe('ordersExport helpers', () => {
  it('fetches every page under the filters', async () => {
    get.mockReset();
    get
      .mockResolvedValueOnce({ data: [rows[0]], meta: { totals: { CAD: { grossCents: 15300, netCents: 14600 } } }, pagination: { totalPages: 2 } })
      .mockResolvedValueOnce({ data: [rows[1]], pagination: { totalPages: 2 } });
    const out = await fetchAllOrders('ev1', { status: 'all', channel: 'manual', search: 'sara' });
    expect(out.rows).toHaveLength(2);
    expect(out.meta.totals.CAD.grossCents).toBe(15300);
    const first = get.mock.calls[0][0];
    expect(first).toContain('/events/ev1/orders?');
    expect(first).toContain('status=all');
    expect(first).toContain('channel=manual');
    expect(first).toContain('q=sara');
    expect(first).toContain('limit=200');
    expect(get.mock.calls[1][0]).toContain('page=2');
  });

  it('summarizes per currency, biggest first, with the database totals winning', () => {
    const s = summarize(rows, { totals: { CAD: { grossCents: 99999, netCents: 88888 } } });
    expect(s.map((x) => x.currency)).toEqual(['CAD', 'USD']);
    expect(s[0]).toMatchObject({ orders: 2, tickets: 3, card: 1, door: 1, discountCents: 1000, grossCents: 99999, netCents: 88888, doorCents: 4000 });
    expect(s[1]).toMatchObject({ orders: 1, grossCents: 2000 });
  });

  it('labels channels, filters, refs, units and file names', () => {
    expect(channelText(rows[0])).toBe('Card');
    expect(channelText(rows[1])).toBe('Door · Cash');
    expect(channelText(order({ channel: 'manual', manual: { method: 'bank_wire' } }))).toBe('Door · Bank wire');
    expect(describeFilters({ status: 'paid', channel: '', search: 'x' })).toEqual(['Paid', 'Every channel', 'Matching “x”']);
    expect(orderRef(rows[0])).toBe('A1B2C3D4');
    expect(toUnits(1999, 'CAD')).toBe(19.99);
    expect(toUnits(1999, 'JPY')).toBe(1999);
    expect(fileBase({ slug: 'Ladies Night!' }, new Date('2026-11-23T10:00:00Z'))).toBe('orders-ladies-night-2026-11-23');
  });
});

describe('the Excel workbook', () => {
  it('formats money in the currency and dates on the event clock', () => {
    expect(moneyFormat('CAD')).toBe('"CA$"#,##0.00;-"CA$"#,##0.00');
    expect(moneyFormat('JPY')).toMatch(/#,##0;/);
    // 23:31 UTC is 18:31 in Toronto (EST), written as 18:31.
    expect(wallClock('2026-11-20T23:31:00Z', 'America/Toronto').toISOString()).toBe('2026-11-20T18:31:00.000Z');
    expect(wallClock(null, 'UTC')).toBeNull();
  });

  it('writes a valid file that reads back with both sheets, real numbers and live totals', async () => {
    const wb = buildOrdersWorkbook(ExcelJS, {
      event, rows, meta: null, filters: { status: 'paid', channel: '', search: '' }, now: new Date('2026-11-23T15:00:00Z'),
    });
    const buffer = await wb.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(5000);

    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buffer);
    expect(back.worksheets.map((w) => w.name)).toEqual(['Summary', 'Orders']);

    const summary = back.getWorksheet('Summary');
    expect(summary.getCell('A4').value).toBe('Ladies Night & Friends');
    expect(summary.getCell('A6').value).toBe('Orders: Paid · Every channel');

    const ws = back.getWorksheet('Orders');
    const headers = ws.getRow(4).values.slice(1);
    expect(headers).toEqual(expect.arrayContaining(['#', 'Order', 'Date (America/Toronto)', 'Buyer', 'Guest of', 'Buyer paid', 'To you', 'Door note']));
    const col = (name) => headers.indexOf(name) + 1;

    // Row 5 is the first order: numbers, not text.
    expect(ws.getRow(5).getCell(col('Buyer paid')).value).toBe(113);
    expect(ws.getRow(5).getCell(col('Buyer paid')).numFmt).toContain('CA$');
    expect(ws.getRow(5).getCell(col('Date (America/Toronto)')).value).toBeInstanceOf(Date);
    // A formula-looking name stays text.
    expect(ws.getRow(6).getCell(col('Buyer')).value).toBe('=HYPERLINK("http://x")');
    expect(ws.getRow(6).getCell(col('Discount')).value).toBe(-10);
    // Add-ons in words; an order without any leaves the cell empty.
    expect(ws.getRow(5).getCell(col('Add-ons')).value).toBe('2 × Photo with the star');
    expect(ws.getRow(6).getCell(col('Add-ons')).value || '').toBe('');

    // Totals: one row per currency, SUMIFS with a cached result.
    const cad = ws.getRow(9).getCell(col('Buyer paid')).value;
    expect(cad.formula).toMatch(/^SUMIFS\(/);
    expect(cad.result).toBe(153);
    expect(ws.getRow(10).getCell(col('Buyer paid')).value.result).toBe(20);

    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 });
    expect(ws.autoFilter).toBeTruthy();
  });

  it('still writes a file when nothing matches', async () => {
    const wb = buildOrdersWorkbook(ExcelJS, { event, rows: [], meta: null, filters: {} });
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(await wb.xlsx.writeBuffer());
    expect(back.getWorksheet('Summary').getCell('A9').value).toBe('No orders match these filters.');
  });
});
