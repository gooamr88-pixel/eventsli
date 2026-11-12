import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';
import AuditDetail, { verbOf, VERBS } from '../src/app/admin/audit/AuditDetail';

/**
 * The audit log rendered "No details recorded" for every SMS and storefront
 * row, over payloads that held the whole change, and showed their verbs as raw
 * codes. These pin the fallback that reads any payload.
 */
const text = (entry) => render(<AuditDetail entry={entry} />).container.textContent;

describe('audit detail', () => {
  test('an SMS change shows the fields it changed', () => {
    const out = text({ action: 'sms.category.updated', payload: { key: 'marketing', changes: { enabled: false, min_role: 'admin' } } });
    expect(out).toContain('key: marketing');
    expect(out).toContain('enabled: false');
    expect(out).toContain('min role: admin');
    expect(out).not.toContain('No details recorded');
  });

  test('a storefront edit names the changed fields, and before/after shows the diff', () => {
    expect(text({ action: 'storefront.sponsor_updated', payload: { changed: ['linkUrl', 'name'] } }))
      .toContain('Changed: link url, name');
    expect(text({ action: 'sms.country.updated', payload: { iso2: 'EG', before: { status: 'disabled' }, after: { status: 'enabled' } } }))
      .toContain('status: disabled → enabled');
  });

  test('a gate change reads as the mode and whether scanning turned on or off', () => {
    const out = text({
      action: 'scanner.override',
      payload: { mode: 'open', until: null, reason: 'Doors open', before: { locked: true }, after: { locked: false } },
    });
    expect(out).toContain('Keep open');
    expect(out).toContain('Scanning turned on');
    expect(out).not.toContain('hours');
  });

  test('a cancellation decision shows both the reason and the admin note', () => {
    const out = text({ action: 'event.cancellation_approved', payload: { reason: 'Venue flooded', note: 'Refunds go out today' } });
    expect(out).toContain('Venue flooded');
    expect(out).toContain('Note: Refunds go out today');
  });

  test('an empty payload still says so, and row ids are not shown', () => {
    expect(text({ action: 'storefront.sponsor_deleted', payload: {} })).toBe('No details recorded');
    expect(text({ action: 'sms.segment.deleted', payload: { id: 'abc' } })).toBe('No details recorded');
  });

  test('every verb has a label, and an unknown one reads as words', () => {
    expect(verbOf('sms.category.updated')[0]).toBe('Edited an SMS category');
    expect(verbOf('something.new_thing')[0]).toBe('Something new thing');
    expect(Object.values(VERBS).every(([label]) => label && !label.includes('.'))).toBe(true);
  });
});
