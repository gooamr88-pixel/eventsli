import { describe, it, expect } from 'vitest';
import { toLocalInput } from '../src/app/lib/eventTime';
import { toIso } from '../src/app/organizer/events/new/NewEventForm';
import { invoiceStatus } from '../src/app/lib/invoiceStatus';
import { messageFor } from '../src/app/utils/errors';

describe('toLocalInput', () => {
  it('shows the instant as the wall-clock time at the venue', () => {
    // 00:00 UTC on 6 Sep is 8pm on 5 Sep in Toronto (EDT).
    expect(toLocalInput('2026-09-06T00:00:00.000Z', 'America/Toronto')).toBe('2026-09-05T20:00');
    expect(toLocalInput('2026-09-06T00:00:00.000Z', 'America/Vancouver')).toBe('2026-09-05T17:00');
  });

  it('round-trips with toIso, so opening and saving the form moves nothing', () => {
    for (const [iso, zone] of [
      ['2026-09-06T00:00:00.000Z', 'America/Toronto'],
      ['2026-12-31T23:30:00.000Z', 'America/New_York'],
      ['2026-03-08T12:00:00.000Z', 'America/Chicago'],   // the day DST starts
      ['2026-06-01T07:00:00.000Z', 'Pacific/Honolulu'],
    ]) {
      expect(toIso(toLocalInput(iso, zone), zone)).toBe(iso);
    }
  });

  it('renders midnight as 00, which a datetime-local input accepts', () => {
    expect(toLocalInput('2026-09-06T04:00:00.000Z', 'America/Toronto')).toBe('2026-09-06T00:00');
  });

  it('returns an empty value rather than throwing', () => {
    expect(toLocalInput(null, 'America/Toronto')).toBe('');
    expect(toLocalInput('not a date', 'America/Toronto')).toBe('');
    expect(toLocalInput('2026-09-06T00:00:00.000Z', 'Not/AZone')).toBe('');
  });
});

describe('invoiceStatus', () => {
  it('labels an invoice the job marked overdue', () => {
    expect(invoiceStatus({ status: 'overdue' })).toEqual({ label: 'Overdue', tone: 'danger' });
  });

  it('labels an unpaid invoice past its due date as overdue before the job runs', () => {
    expect(invoiceStatus({ status: 'open', isOverdue: true }).tone).toBe('danger');
    expect(invoiceStatus({ status: 'submitted', isOverdue: true }).label).toBe('Overdue · receipt sent');
  });

  it('never calls a settled invoice overdue', () => {
    expect(invoiceStatus({ status: 'paid', isOverdue: true })).toEqual({ label: 'Settled', tone: 'accent' });
  });

  it('keeps an unknown status readable', () => {
    expect(invoiceStatus({ status: 'something_new' }).label).toBe('something_new');
    expect(invoiceStatus(null).label).toBe('—');
  });
});

describe('messageFor', () => {
  it("prefers the server's specific message", () => {
    const err = Object.assign(new Error('Tickets have already sold, so feeBearer can no longer change.'), { code: 'CONFLICT' });
    expect(messageFor(err)).toMatch(/feeBearer/);
  });

  it('falls back to the recovery line when there is nothing specific', () => {
    const network = Object.assign(new Error('Failed to fetch'), { code: 'NETWORK' });
    expect(messageFor(network)).not.toBe('Failed to fetch');
    expect(messageFor({ code: 'CONFLICT' }).length).toBeGreaterThan(15);
  });
});
