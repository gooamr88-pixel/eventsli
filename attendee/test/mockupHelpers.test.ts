import type { EventCard } from '../src/api/types';
import { coversByCategory } from '../src/hooks/useCategoryCovers';
import { splitAbout } from '../src/lib/about';
import { countryName } from '../src/lib/format';

/** The helpers behind the mockup match (2026-11-28). */
describe('splitAbout: the tagline under the title', () => {
  it('takes a short first line as the tagline when more follows', () => {
    expect(splitAbout('Live the ultimate music experience.\n\nGet ready for an unforgettable night with the biggest artists.'))
      .toEqual({ tagline: 'Live the ultimate music experience.', body: 'Get ready for an unforgettable night with the biggest artists.' });
  });

  it('keeps a single paragraph whole, with no tagline', () => {
    const one = 'Get ready for an unforgettable night with the biggest artists in one place.';
    expect(splitAbout(one)).toEqual({ tagline: null, body: one });
  });

  it('does not take a long first line, or one with almost nothing after it', () => {
    const long = `${'A very long opening sentence '.repeat(4)}\nMore text that follows it here.`;
    expect(splitAbout(long).tagline).toBeNull();
    expect(splitAbout('Short line\nok').tagline).toBeNull();
    expect(splitAbout(null)).toEqual({ tagline: null, body: null });
  });
});

describe('coversByCategory: a real event photo per category tile', () => {
  const ev = (id: string, category: string | null, coverUrl: string | null, extra: Partial<EventCard> = {}) =>
    ({ id, category, coverUrl, ...extra }) as EventCard;

  it('uses the first public cover in each category', () => {
    const m = coversByCategory(
      [ev('a', 'music', 'https://x/a.jpg'), ev('b', 'music', 'https://x/b.jpg'), ev('c', 'sports', null)],
      [ev('d', 'sports', 'https://x/d.jpg')],
    );
    expect(m.get('music')).toBe('https://x/a.jpg');
    expect(m.get('sports')).toBe('https://x/d.jpg');
  });

  it('never shows a private or blurred cover on a public tile', () => {
    const m = coversByCategory([ev('a', 'gala', 'https://x/p.jpg', { isPrivate: true }), ev('b', 'gala', 'https://x/q.jpg', { blurredCover: true })]);
    expect(m.has('gala')).toBe(false);
  });
});

it('names a country in full, or shows the code when it cannot', () => {
  expect(['Egypt', 'EG']).toContain(countryName('EG'));
  expect(countryName('')).toBe('');
});
