import { optimisedUrl, widthFor } from '../src/lib/images';

const cover = 'https://qvoyxwszojwyyelsjskm.supabase.co/storage/v1/object/public/event-media/events/e1/cover-1.jpg';

test('asks the site optimiser for the smallest accepted width that is sharp on this screen', () => {
  expect(widthFor(200, 3)).toBe(640); // 600 px → 640
  expect(widthFor(390, 3)).toBe(1200); // a full-width hero
  expect(widthFor(88, 2)).toBe(256);
  expect(widthFor(5000, 3)).toBe(1920); // never beyond the largest
});

test('rewrites a Supabase storage cover through eventsli.com, encoded, at quality 75', () => {
  const u = optimisedUrl(cover, 200, 3, true);
  expect(u).toBe(`https://eventsli.com/_next/image?url=${encodeURIComponent(cover)}&w=640&q=75`);
});

test('leaves other hosts, and development builds, alone', () => {
  expect(optimisedUrl('https://eventsli.com/categories/music.jpg', 200, 3, true)).toBe('https://eventsli.com/categories/music.jpg');
  expect(optimisedUrl('https://evil.example/storage/v1/object/public/x.jpg', 200, 3, true)).toBe('https://evil.example/storage/v1/object/public/x.jpg');
  expect(optimisedUrl(cover, 200, 3, false)).toBe(cover);
});
