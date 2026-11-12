import { describe, it, expect } from 'vitest';
import { describeGate, gateModeLabel } from '../src/app/lib/gateState';
import { invoiceStatus } from '../src/app/lib/invoiceStatus';

/**
 * One description of the gate for every screen. The old wording said "settle
 * your commission invoice" whatever the reason — wrong for a cancellation, an
 * admin's stop, or an admin keeping an event open despite an overdue invoice.
 */
describe('describeGate', () => {
  it('names an admin closure as Eventsli’s, with the reason and end', () => {
    const d = describeGate({ locked: true, reason: 'admin_closed', mode: 'closed', mode_reason: 'Venue dispute', mode_until: '2027-01-20T09:00:00Z' }, { timezone: 'Australia/Sydney' });
    expect(d.locked).toBe(true);
    expect(d.title).toMatch(/by Eventsli/);
    expect(d.detail).toMatch(/Venue dispute/);
    expect(d.detail).toMatch(/Jan 20, 2027/);
  });

  it('only talks about invoices when an invoice is the reason', () => {
    expect(describeGate({ locked: true, reason: 'commission_overdue' }).detail).toMatch(/invoice/);
    expect(describeGate({ locked: true, reason: 'event_cancelled' }).detail).toMatch(/cancelled/);
    expect(describeGate({ locked: true, reason: 'admin_closed' }).detail).not.toMatch(/invoice/);
  });

  it('tells an admin an open gate is hiding an overdue invoice; tells the organizer it is on', () => {
    const gate = { locked: false, reason: 'admin_open', override: true, mode: 'open', overdue_invoices: 2 };
    const admin = describeGate(gate, { audience: 'admin' });
    expect(admin.tone).toBe('warning');
    expect(admin.detail).toMatch(/2 overdue invoices/);
    expect(describeGate(gate).title).toBe('Scanning is on');
  });

  it('warns when the gate will lock at a known time', () => {
    const d = describeGate({ locked: false, locks_at: '2027-01-20T09:00:00Z' }, { timezone: 'UTC' });
    expect(d.tone).toBe('warning');
    expect(d.detail).toMatch(/switches off/);
  });

  it('labels the admin mode', () => {
    expect(gateModeLabel({ mode: 'closed' })).toBe('Kept closed');
    expect(gateModeLabel({ mode: 'open' })).toBe('Kept open');
    expect(gateModeLabel({})).toBe('Following invoices');
    expect(gateModeLabel({ reason: 'event_cancelled' })).toBe('Cancelled');
  });
});

describe('invoiceStatus with payments', () => {
  it('reads part payments, rejections and voids', () => {
    expect(invoiceStatus({ status: 'open', paidCents: 100 }).label).toBe('Part paid');
    expect(invoiceStatus({ status: 'overdue', paidCents: 100 }).label).toBe('Overdue · part paid');
    expect(invoiceStatus({ status: 'open', receiptRejectedAt: '2026-11-11T00:00:00Z' }).label).toBe('Receipt not accepted');
    expect(invoiceStatus({ status: 'void' }).label).toBe('Void');
    expect(invoiceStatus({ status: 'waived', paidCents: 300 }).label).toBe('Part paid · rest waived');
  });
});
