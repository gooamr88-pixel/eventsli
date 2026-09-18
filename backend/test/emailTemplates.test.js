const test = require('node:test');
const assert = require('node:assert/strict');

const T = require('../services/emailTemplates');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EMAIL DESIGN SYSTEM, asserted.
 *
 * Email is the one surface with no error reporting: a template that renders
 * wrongly does so in somebody else's inbox, is never logged, and is found — if
 * ever — by a customer. The ticket email said "[object Object]" where the seat
 * should be and nobody noticed, because the QR beside it scanned perfectly.
 *
 * So the things that cannot be seen from here are the things tested here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

test('seatLabel — the bug that shipped', async (t) => {
  await t.test('a seat OBJECT is formatted, never stringified', () => {
    // `ticketService.shape()` returns `{ section, row, number }`. Interpolating
    // it produced "[object Object]" on every assigned-seat ticket ever sent.
    const label = T.seatLabel({ seat: { section: 'Balcony', row: 'C', number: 12 }, table: null });
    assert.equal(label, 'Balcony · row C · seat 12');
    assert.ok(!label.includes('[object'));
  });

  await t.test("row 'A' is dropped, because every table seat has one", () => {
    assert.equal(
      T.seatLabel({ seat: { section: 'T2', row: 'A', number: 5 }, table: null }),
      'T2 · seat 5',
    );
  });

  await t.test('a table booking names its table', () => {
    assert.equal(T.seatLabel({ seat: null, table: 'T1' }), 'Table T1');
  });

  await t.test('a seat at a table names the table once, not twice', () => {
    // A table seat's `section` IS the table's label, so repeating it produced
    // "Table T1 · T1 · seat 3" — which reads as a rendering fault.
    assert.equal(
      T.seatLabel({ seat: { section: 'T1', row: 'A', number: 3 }, table: 'T1' }),
      'Table T1 · seat 3',
    );
  });

  await t.test('a seat in a different section to its table keeps both', () => {
    assert.equal(
      T.seatLabel({ seat: { section: 'Balcony', row: 'C', number: 4 }, table: 'T9' }),
      'Table T9 · Balcony · row C · seat 4',
    );
  });

  await t.test('general admission has neither, and says so', () => {
    assert.equal(T.seatLabel({ seat: null, table: null }), 'General admission');
    assert.equal(T.seatLabel({}), 'General admission');
    assert.equal(T.seatLabel(null), 'General admission');
  });

  await t.test('an already-formatted string is passed through', () => {
    assert.equal(T.seatLabel({ seat: 'Floor · seat 9' }), 'Floor · seat 9');
  });
});

test('escaping — an event title is organizer-controlled text', async (t) => {
  await t.test('markup in a title cannot reach the inbox as markup', () => {
    const html = T.eventCard({ title: '<script>alert(1)</script>' });
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  await t.test('a quoted reason is escaped too', () => {
    assert.ok(!T.quote('<img onerror=x>').includes('<img'));
  });
});

test('the layout', async (t) => {
  const html = T.layout({ title: 'Your ticket', preheader: 'Tonight', body: '<p>Hi</p>' });

  await t.test('carries the name, so the sender is recognisable', () => {
    assert.ok(html.includes('Eventsli'));
  });

  await t.test('states a color-scheme, against Gmail’s wholesale inversion', () => {
    assert.ok(html.includes('color-scheme'));
  });

  await t.test('the preheader is present and hidden', () => {
    assert.ok(html.includes('Tonight'));
    assert.ok(html.includes('mso-hide:all'));
  });

  await t.test('no <style> block — Gmail strips them on mobile', () => {
    assert.ok(!/<style[\s>]/i.test(html));
  });

  await t.test('no SVG — Outlook and Gmail drop it', () => {
    assert.ok(!/<svg[\s>]/i.test(html));
  });

  await t.test('the title is escaped like everything else', () => {
    assert.ok(!T.layout({ title: '<b>x</b>', body: '' }).includes('<b>x</b>'));
  });
});

test('the event card is the point of the redesign', async (t) => {
  const card = T.eventCard({
    title: 'Cruise Meeting',
    startsAt: '2026-09-25T23:00:00.000Z',
    timezone: 'America/Los_Angeles',
    venue: 'Mission Bay Dan Landing',
    city: 'San Diego',
    organizerName: 'Via',
    slug: 'cruise-meeting',
  });

  await t.test('shows when, where and who — not just the title', () => {
    assert.ok(card.includes('Cruise Meeting'));
    assert.ok(card.includes('Mission Bay Dan Landing'));
    assert.ok(card.includes('San Diego'));
    assert.ok(card.includes('Via'));
  });

  await t.test('the time is in the EVENT’s zone, not the server’s', () => {
    // 23:00 UTC is 16:00 in Los Angeles. A server in UTC printing its own
    // clock would say 11 PM, and the buyer would arrive seven hours late.
    assert.ok(card.includes('4:00'), `expected a 4pm local time, got: ${card}`);
    assert.ok(card.includes('America/Los_Angeles'));
  });

  await t.test('a row with no value is omitted, never shown empty', () => {
    const bare = T.eventCard({ title: 'Just a title' });
    assert.ok(bare.includes('Just a title'));
    assert.ok(!bare.includes('Where'));
    assert.ok(!bare.includes('Organizer'));
  });

  await t.test('no event means no card, rather than an empty box', () => {
    assert.equal(T.eventCard({}), '');
  });
});

test('money', async (t) => {
  await t.test('formats cents as the order’s own currency', () => {
    assert.match(T.money(7900, 'CAD'), /79\.00/);
  });

  await t.test('a free ticket is not an error', () => {
    assert.match(T.money(0, 'USD'), /0\.00/);
  });

  await t.test('an unknown currency degrades instead of throwing', () => {
    // An email must never fail to send over a formatting detail.
    assert.doesNotThrow(() => T.money(1000, 'NOTACURRENCY'));
  });
});
