import { describe, test, expect } from 'vitest';
import { splitDescription, firstSentence } from '../src/app/e/[slug]/page';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ABOUT PANEL IS DERIVED FROM ONE FIELD, so the derivation has to be safe.
 *
 * The mockup opens About with a serif heading, a short paragraph and a "Show
 * more". The API has no heading field — there is one `description` an organizer
 * typed — so the heading is taken from the text when the text offers one.
 *
 * Everything here is about NOT inventing one. A description written as prose
 * has no title in it, and cutting a running sentence in half to fill a display
 * slot reads as a bug on the most-shared page on the platform.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('splitDescription — when the first line becomes a heading', () => {
  test('a short standalone first paragraph is the heading', () => {
    const { aboutTitle, aboutLead } = splitDescription(
      'A Unique Networking Experience on the Water\n\nJoin us for a memorable evening.',
    );
    expect(aboutTitle).toBe('A Unique Networking Experience on the Water');
    expect(aboutLead).toBe('Join us for a memorable evening.');
  });

  test('a first line ending in a full stop is a sentence, not a heading', () => {
    const { aboutTitle, aboutLead } = splitDescription(
      'Join us on the water.\n\nMore about the evening.',
    );
    expect(aboutTitle).toBeNull();
    expect(aboutLead).toBe('Join us on the water.');
  });

  test('a long first line is prose, however it is punctuated', () => {
    const long = 'An evening of meaningful conversations and great company aboard a luxury cruise around the bay';
    expect(long.length).toBeGreaterThan(70);
    expect(splitDescription(`${long}\n\nSecond paragraph.`).aboutTitle).toBeNull();
  });

  test('one paragraph is a description, never a title with nothing under it', () => {
    const { aboutTitle, aboutLead } = splitDescription('Cruise Meeting');
    expect(aboutTitle).toBeNull();
    expect(aboutLead).toBe('Cruise Meeting');
  });

  test('a first paragraph of two lines is not a heading', () => {
    // Two lines run together are a stanza or an address, not a title — taking
    // the first of them would leave the second orphaned above the body.
    expect(splitDescription('Doors at seven\nBring ID\n\nThen the show.').aboutTitle).toBeNull();
  });
});

describe('splitDescription — the fold', () => {
  test('everything after the opening paragraph goes behind Show more', () => {
    const { aboutLead, aboutRest } = splitDescription('Heading here\n\nFirst.\n\nSecond.\n\nThird.');
    expect(aboutLead).toBe('First.');
    expect(aboutRest).toBe('Second.\n\nThird.');
  });

  test('a two-paragraph description has nothing to fold', () => {
    expect(splitDescription('Heading here\n\nOnly paragraph.').aboutRest).toBe('');
  });

  test('an empty description produces nothing at all', () => {
    expect(splitDescription('')).toEqual({ aboutTitle: null, aboutLead: '', aboutRest: '' });
    expect(splitDescription(null).aboutLead).toBe('');
    expect(splitDescription(undefined).aboutTitle).toBeNull();
  });
});

describe('firstSentence — the line under the title in the hero', () => {
  test('stops at the first full stop', () => {
    expect(firstSentence('Connect with business leaders. And more text here.', 120))
      .toBe('Connect with business leaders.');
  });

  test('keeps a question or an exclamation', () => {
    expect(firstSentence('Ready for a night out? Then come.', 120)).toBe('Ready for a night out?');
  });

  test('collapses the newlines an organizer typed', () => {
    expect(firstSentence('Come\n  aboard   a\nluxury cruise.', 120)).toBe('Come aboard a luxury cruise.');
  });

  test('truncates on a word boundary, never mid-word', () => {
    const out = firstSentence('Networking and relaxing aboard a luxury vessel in the bay', 20);
    expect(out.endsWith('…')).toBe(true);
    // The cut lands between words: no partial word before the ellipsis.
    expect(out.slice(0, -1).trim()).toBe('Networking and');
  });

  test('a sentence inside the limit is returned whole, with no ellipsis', () => {
    expect(firstSentence('Short one.', 120)).toBe('Short one.');
  });

  test('nothing in, nothing out', () => {
    expect(firstSentence('', 120)).toBeNull();
    expect(firstSentence(null, 120)).toBeNull();
  });
});
