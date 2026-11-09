import { guestCountLine, guestEmpty, guestQuery } from '../src/gate/guestSearch';

/**
 * Seen at the door: after most guests had been scanned, searching "John" on
 * the guest list said "Nobody matches". The list opens on "Not yet" and the
 * search ran inside that filter, so anyone already inside could not be found
 * by name. A search now covers every guest.
 */
describe('what the guest list asks for', () => {
  test('a search covers every guest, whatever the filter', () => {
    expect(guestQuery('John', 'out')).toEqual({ q: 'John', status: 'all', searching: true });
    expect(guestQuery('John', 'in')).toEqual({ q: 'John', status: 'all', searching: true });
    expect(guestQuery('John', 'all')).toEqual({ q: 'John', status: 'all', searching: true });
  });

  test('browsing (nothing typed) follows the filter', () => {
    expect(guestQuery('', 'out')).toEqual({ q: '', status: 'out', searching: false });
    expect(guestQuery('', 'in')).toEqual({ q: '', status: 'in', searching: false });
  });

  test('spaces alone are not a search, and inner spaces are tidied', () => {
    expect(guestQuery('   ', 'out')).toEqual({ q: '', status: 'out', searching: false });
    expect(guestQuery('  John   Smith ', 'out').q).toBe('John Smith');
  });

  test('the count line says what is being shown', () => {
    expect(guestCountLine(2, guestQuery('john', 'out'))).toBe('2 guests match “john”');
    expect(guestCountLine(1, guestQuery('john', 'out'))).toBe('1 guest matches “john”');
    expect(guestCountLine(3, guestQuery('', 'out'))).toBe('3 guests not yet in');
    expect(guestCountLine(14, guestQuery('', 'in'))).toBe('14 guests checked in');
    expect(guestCountLine(17, guestQuery('', 'all'))).toBe('17 guests on the list');
  });

  test('an empty search says nobody on the list matches, never "not yet"', () => {
    const empty = guestEmpty(guestQuery('Zed', 'out'));
    expect(empty.title).toBe('Nobody on the guest list matches “Zed”');
    expect(empty.body).toMatch(/email/);
  });

  test('an empty filter says why it is empty', () => {
    expect(guestEmpty(guestQuery('', 'out')).title).toBe('Everyone is in');
    expect(guestEmpty(guestQuery('', 'in')).title).toBe('Nobody is in yet');
  });
});
