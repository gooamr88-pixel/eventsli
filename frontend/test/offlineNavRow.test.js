import { describe, test, expect } from 'vitest';
import { organizerNavGroups } from '../src/app/organizer/nav/organizerNav';

/** "Where is the offline payments section where the organizer approves?" (2026-11-24) */
const sell = (offline) => organizerNavGroups({ eventId: 'e1', offline }).find((g) => g.id === 'sell').items;

describe('the Offline payments row', () => {
  test('its own row under Orders, with the number waiting for approval', () => {
    const items = sell({ show: true, awaiting: 3 });
    const keys = items.map((i) => i.key);
    expect(keys.indexOf('offline')).toBe(keys.indexOf('orders') + 1);
    const row = items.find((i) => i.key === 'offline');
    expect(row.href).toBe('/organizer/events/e1/offline');
    expect(row.badge).toBe(3);
    expect(items.find((i) => i.key === 'orders').also).not.toContain('/organizer/events/e1/offline');
  });

  test('no badge when nothing waits; no row for an event without offline payments', () => {
    expect(sell({ show: true, awaiting: 0 }).find((i) => i.key === 'offline').badge).toBeNull();
    expect(sell({ show: false, awaiting: 0 }).some((i) => i.key === 'offline')).toBe(false);
    expect(sell(null).some((i) => i.key === 'offline')).toBe(false);
  });
});
