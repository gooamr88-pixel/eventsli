import { describe, test, expect } from 'vitest';
import { addedMessage } from '../src/app/organizer/events/[id]/content/GalleryEditor';

/**
 * REGRESSION (2026-10-16) — the gallery announced "3 photos added" after a
 * batch in which none had been saved, directly under the error saying so. The
 * toast now reports what was saved, and is not shown at all for nothing.
 */
describe('gallery toast', () => {
  test('a full batch says how many', () => {
    expect(addedMessage(3, 3)).toBe('3 photos added.');
    expect(addedMessage(1, 1)).toBe('Photo added.');
  });

  test('a batch that stopped part-way says so', () => {
    expect(addedMessage(1, 3)).toBe('1 of 3 photos added.');
  });
});
